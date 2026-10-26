import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { IntegrationMaintenanceQueue } from "../src/server/integration-maintenance.js";
import { MaintenanceService } from "../src/server/maintenance.js";
import { defaultMaintenanceBudgets } from "../src/shared/maintenance.js";
const turn = () => new Promise<void>(resolve => setTimeout(resolve, 25));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

test("maintenance reservations drain admitted work, stay FIFO across cancellation and release after failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "integration-maintenance-")), service = new MaintenanceService(root);
  const gate = deferred(), order: string[] = []; let active = true;
  const queue = new IntegrationMaintenanceQueue(() => active ? ["先前子代理任务"] : [], async work => { await gate.promise; return work(); });
  const run = (id: string, work: () => void) => service.run({ id, resource: id, label: id, action: "uninstall", cancel: false }, new AbortController(), () => queue.run(work));
  try {
    const a = run("a", () => { order.push("a"); throw Error("disk busy"); }); void a.catch(() => {});
    const b = run("b", () => { order.push("b"); }); void b.catch(() => {});
    const c = run("c", () => { order.push("c"); });
    assert.equal(queue.pending, true); assert.deepEqual(order, []);
    assert.ok(service.snapshot().tasks.every(task => task.phase === "queued" && task.capabilities.cancel));
    // Cancellation of B must not allow C to overtake A's physical barrier.
    service.command({ requestId: "cancel", op: "maintenance.cancel", params: { id: "b" } });
    await assert.rejects(b, { code: "cancelled" }); assert.deepEqual(order, []);
    active = false; await turn(); assert.deepEqual(order, []);
    gate.resolve(); await assert.rejects(a, /disk busy/); await c;
    assert.deepEqual(order, ["a", "c"]); assert.equal(queue.pending, false);
  } finally { queue.close(); gate.resolve(); service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("queued maintenance has a finite total budget and shutdown cancels reservations", async () => {
  const root = mkdtempSync(join(tmpdir(), "integration-maintenance-timeout-")), service = new MaintenanceService(root);
  const queue = new IntegrationMaintenanceQueue(() => ["busy"], async work => work()); let removed = false;
  try {
    await assert.rejects(service.run({ id: "timeout", resource: "rea", label: "REA", action: "uninstall", queued: true, params: { budgets: { ...defaultMaintenanceBudgets, totalMs: 1000 } } }, new AbortController(), () => queue.run(() => { removed = true; })), { code: "total-timeout" });
    assert.equal(removed, false); assert.equal(queue.pending, false);
    const pending = service.run({ id: "shutdown", resource: "rtk", label: "RTK", action: "uninstall" }, new AbortController(), () => queue.run(() => { removed = true; }));
    queue.close(); await assert.rejects(pending, { code: "cancelled" }); assert.equal(removed, false); assert.equal(queue.pending, false);
  } finally { queue.close(); service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("safe-point blockers are rechecked after physical close before destructive commit", async () => {
  let changed = false, attempts = 0, removed = false;
  const queue = new IntegrationMaintenanceQueue(() => changed ? ["new blocker"] : [], async work => { attempts++; changed = true; return work(); });
  const pending = queue.run(() => { removed = true; }); void pending.catch(() => {});
  await turn(); assert.equal(removed, false); assert.equal(attempts, 1);
  queue.close(); await assert.rejects(pending, { code: "cancelled" });
});
