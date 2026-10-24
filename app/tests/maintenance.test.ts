import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { MaintenanceService, currentMaintenance } from "../src/server/maintenance.js";
import { maintenanceFetch } from "../src/shared/maintenance-runtime.js";
import { defaultMaintenanceBudgets, MaintenanceError } from "../src/shared/maintenance.js";
import { executeOpenCli } from "../src/server/integrations/opencli.js";
const short = { headersMs: 80, idleMs: 80, totalMs: 3000, installMs: 3000 };

test("header timeout and user cancellation remain distinct", async () => {
  const blocked: typeof fetch = async (_url, init) => { await delay(10_000, undefined, { signal: init!.signal! }); throw Error("unreachable"); };
  await assert.rejects(maintenanceFetch("https://fixture.invalid", {}, undefined, short, blocked), { code: "headers-timeout" });
  const controller = new AbortController();
  const pending = maintenanceFetch("https://fixture.invalid", { signal: controller.signal }, undefined, short, blocked);
  controller.abort(new MaintenanceError("cancelled", "cancelled"));
  await assert.rejects(pending, { code: "cancelled" });
});
test("idle timeout interrupts body while sustained slow data and unknown length succeed", async () => {
  const stalled: typeof fetch = async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); } }));
  const response = await maintenanceFetch("https://fixture.invalid", {}, undefined, short, stalled);
  await assert.rejects(response.text(), { code: "idle-timeout" });
  let remaining = 6;
  const slow: typeof fetch = async () => new Response(new ReadableStream({ async pull(stream) { await delay(60); if (remaining--) stream.enqueue(new Uint8Array([97])); else stream.close(); } }));
  assert.equal(await (await maintenanceFetch("https://fixture.invalid", {}, undefined, { ...short, idleMs: 150 }, slow)).text(), "aaaaaa");
});
test("task history retains real progress, does not record subscription credentials and recovers interrupted work", async t => {
  const root = mkdtempSync(join(tmpdir(), "axiom-maintenance-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const service = new MaintenanceService(root); t.after(() => service.close());
  await service.run({ id: "one", resource: "test", label: "测试", action: "install", cancel: true }, new AbortController(), async () => {
    const execution = currentMaintenance()!;
    const fetcher: typeof fetch = async () => new Response("hello", { headers: { "content-length": "5" } });
    const response = await maintenanceFetch("https://fixture.invalid/secret?token=private", {}, execution, undefined, fetcher);
    assert.equal(await response.text(), "hello");
    assert.equal(service.snapshot().tasks[0].transfer?.received, 5);
    assert.equal(service.snapshot().tasks[0].transfer?.total, 5);
    assert.equal(service.snapshot().tasks[0].status, "running", "download completion is not installation completion");
    execution.phase("validating");
  });
  const saved = service.snapshot(); assert.equal(saved.tasks[0].status, "succeeded");
  assert.ok(!JSON.stringify(saved).includes("private")); assert.ok(!JSON.stringify(saved).includes("/secret"));
  saved.tasks[0].status = "running";
  writeFileSync(join(root, "maintenance/tasks.json"), JSON.stringify(saved));
  const restored = new MaintenanceService(root); t.after(() => restored.close());
  assert.equal(restored.snapshot().tasks[0].status, "interrupted");
  restored.command({ op: "maintenance.clear", requestId: "clear" });
  assert.equal(restored.snapshot().tasks.length, 1, "unverified work cannot be cleared");
});
test("running task deadline can be extended without restarting; decreasing it is rejected", async t => {
  const root = mkdtempSync(join(tmpdir(), "axiom-maintenance-budget-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const service = new MaintenanceService(root); t.after(() => service.close());
  let count = 0;
  const controller = new AbortController();
  const budgets = { ...defaultMaintenanceBudgets, totalMs: 1000 };
  const pending = service.run({ id: "extend", resource: "test", label: "测试", action: "check", params: { budgets } }, controller, async () => { count++; await delay(1200, undefined, { signal: controller.signal }); });
  service.command({ op: "maintenance.extend", requestId: "extend-1", params: { id: "extend", budgets: { ...budgets, totalMs: 3000 } } });
  assert.throws(() => service.command({ op: "maintenance.extend", requestId: "extend-2", params: { id: "extend", budgets } }), { code: "INVALID_BUDGETS" });
  await pending; assert.equal(count, 1); assert.equal(service.snapshot().tasks[0].status, "succeeded");
});
test("history retention, duplicate admission, pre-cancellation and transient storage recovery", async t => {
  const root = mkdtempSync(join(tmpdir(), "axiom-maintenance-boundaries-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const service = new MaintenanceService(root); t.after(() => service.close());
  const admission = { id: "first", resource: "test", label: "测试", action: "check", cancel: true };
  const cancelled = new AbortController(); cancelled.abort(new MaintenanceError("cancelled", "cancelled"));
  let ran = false;
  await assert.rejects(service.run(admission, cancelled, async () => { ran = true; }), { code: "cancelled" });
  assert.equal(ran, false);
  let release!: () => void;
  const pending = service.run({ ...admission, id: "active" }, new AbortController(), () => new Promise<void>(resolve => { release = resolve; }));
  await assert.rejects(service.run({ ...admission, id: "active" }, new AbortController(), async () => {}), { code: "DUPLICATE_TASK" });
  release(); await pending;
  const saved = service.snapshot(), base = saved.tasks[0];
  saved.tasks = [{ ...base, id: "unverified", status: "interrupted" }, ...Array.from({ length: 101 }, (_, i) => ({ ...base, id: String(i) }))];
  const path = join(root, "maintenance/tasks.json"); writeFileSync(path, JSON.stringify(saved));
  const restored = new MaintenanceService(root); t.after(() => restored.close());
  assert.ok(restored.snapshot().tasks.some(task => task.id === "unverified"));
  rmSync(path); mkdirSync(path);
  await assert.rejects(restored.run({ ...admission, id: "storage-failed" }, new AbortController(), async () => { throw Error("must not execute"); }), { code: "STORAGE_ERROR" });
  const rejected = restored.snapshot().tasks.at(-1)!;
  assert.ok(rejected.finishedAt); assert.equal(rejected.capabilities.cancel, false); assert.ok(rejected.error);
  rmSync(path, { recursive: true });
  await restored.run({ ...admission, id: "recovered" }, new AbortController(), async () => {});
  assert.equal(restored.snapshot().error, undefined);
});

test("cleanup uncertainty survives cancellation, later catches and history reload", async t => {
  const root = mkdtempSync(join(tmpdir(), "axiom-maintenance-uncertain-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const service = new MaintenanceService(root); t.after(() => service.close());
  const controller = new AbortController();
  await assert.rejects(service.run({ id: "uncertain", resource: "fixture", label: "测试", action: "install", cancel: true }, controller, async () => {
    controller.abort(new MaintenanceError("cancelled", "cancel requested"));
    currentMaintenance()!.fail(new MaintenanceError("stop-unconfirmed", "process exit not confirmed"));
    // A service adapter may have recorded the cleanup error before returning.
  }), { code: "stop-unconfirmed" });
  assert.equal(service.snapshot().tasks[0].status, "unknown");
  assert.equal(service.snapshot().tasks[0].error?.message, "process exit not confirmed");
  const restored = new MaintenanceService(root); t.after(() => restored.close());
  restored.command({ op: "maintenance.clear", requestId: "clear" });
  assert.equal(restored.snapshot().tasks[0].status, "unknown");
});

test("large install logs do not kill process; structured output overflow is reported separately", async t => {
  const root = mkdtempSync(join(tmpdir(), "axiom-maintenance-output-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = join(root, "installer.cjs"), marker = join(root, "finished");
  // The overflow run may be stopped between open/truncate and write. Only the
  // successful installer run owns this completion marker.
  writeFileSync(script, `process.stdout.write('x'.repeat(200000)); if (process.argv.includes('install')) require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'done');`);
  const options = { cwd: root, env: process.env, signal: new AbortController().signal, timeout: 10000 };
  assert.equal((await executeOpenCli([script, "install"], options)).length, 128000);
  assert.equal(readFileSync(marker, "utf8"), "done");
  await assert.rejects(executeOpenCli([script], options), { code: "output-limit" });
  assert.equal(readFileSync(marker, "utf8"), "done");
});
