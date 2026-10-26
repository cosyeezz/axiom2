import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
const { DesktopExecution, desktopTask, budgetsDefault } = await import(new URL("../desktop/maintenance.mjs", import.meta.url).href);
const { createUpdater } = await import(new URL("../desktop/updater.mjs", import.meta.url).href);
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test("unconfirmed desktop cleanup takes precedence over cancellation and timeout", async () => {
  for (const reason of ["cancelled", "total-timeout"]) {
    const snapshots: any[] = [];
    const execution = new DesktopExecution(desktopTask("pi", "update"), async (task: any) => { snapshots.push(task); });
    try {
      execution.abort(reason, "initial stop request");
      await execution.finish(Object.assign(Error("tree cleanup has not been confirmed"), { code: "stop-unconfirmed" }));
      assert.equal(snapshots.at(-1).status, "unknown");
      assert.equal(snapshots.at(-1).error.code, "stop-unconfirmed");
      assert.deepEqual(snapshots.at(-1).capabilities, { cancel: false, extend: false });
    } finally { clearInterval(execution.timer); }
  }
});

test("desktop terminal publication recovers after a temporary storage failure", async () => {
  let fail = true; const snapshots: any[] = [];
  const execution = new DesktopExecution(desktopTask("check", "check"), async (task: any) => {
    if (fail) { fail = false; throw Error("temporary storage error"); } snapshots.push(task);
  });
  try {
    await assert.rejects(execution.phase("checking", "checking"), /temporary storage/);
    await execution.finish(Error("operation failed"));
    assert.equal(snapshots.at(-1).status, "failed");
    assert.equal(snapshots.at(-1).error.message, "operation failed");
  } finally { clearInterval(execution.timer); }
});

test("late controls cannot change or republish a finished desktop task", async () => {
  const control = gate<unknown>(); const snapshots: any[] = [];
  const execution = new DesktopExecution(desktopTask("service", "update"), async (task: any) => { snapshots.push(task); }, () => control.promise);
  try {
    await execution.phase("installing", "installing");
    const polling = execution.tick();
    await execution.finish(); const count = snapshots.length;
    control.resolve({ cancel: true, budgets: { ...budgetsDefault, totalMs: 86400000 } }); await polling;
    assert.equal(execution.signal.aborted, false);
    assert.equal(snapshots.length, count);
    assert.equal(snapshots.at(-1).status, "succeeded");
    assert.equal(snapshots.at(-1).budgets.totalMs, budgetsDefault.totalMs);
  } finally { control.resolve(null); clearInterval(execution.timer); }
});

test("desktop download cancellation rejects a stalled reader even when source cancellation hangs", { timeout: 5000 }, async () => {
  const execution = new DesktopExecution(desktopTask("client", "download"), async () => {});
  try {
    await execution.phase("downloading", "downloading");
    const response = await execution.fetch("https://example.test/file?secret=hidden", async () => new Response(new ReadableStream({ cancel: () => new Promise(() => {}) })));
    const reading = response.text();
    execution.abort("cancelled", "cancelled");
    await assert.rejects(reading, { code: "cancelled" });
    assert.equal(execution.task.transfer.source, "https://example.test");
    await execution.finish(); assert.equal(execution.task.status, "cancelled");
  } finally { clearInterval(execution.timer); }
});

test("desktop cancellation after a completed stream does not error a closed stream", async () => {
  const execution = new DesktopExecution(desktopTask("client", "download"), async () => {});
  try {
    const response = await execution.fetch("https://example.test/file", async () => new Response("bytes"));
    assert.equal(await response.text(), "bytes");
    execution.abort("cancelled", "cancelled"); await execution.finish();
    assert.equal(execution.task.status, "cancelled");
  } finally { clearInterval(execution.timer); }
});

test("a second desktop process extends and cancels the active SQLite task", { timeout: 15000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "axiom-maintenance-control-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const packageRoot = join(root, "prefix/node_modules/@cosyeezz/axiom2");
  await mkdir(join(packageRoot, "bin"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "@cosyeezz/axiom2", version: "0.1.0" }));
  await writeFile(join(root, "installation.json"), JSON.stringify({ node: process.execPath, cli: join(packageRoot, "bin/axiom2.mjs") }));
  const entered = gate<void>();
  const updater = createUpdater({ root, fetcher: async () => { entered.resolve(); return new Response(new ReadableStream({})); } });
  const work = updater.runJob("check");
  await entered.promise;
  const first = await updater.status(); const id = first.job.task.id;
  const control = async (action: string, payload: unknown) => {
    const result = await promisify(execFile)(process.execPath, [fileURLToPath(new URL("../desktop/updater.mjs", import.meta.url)), action, JSON.stringify(payload)], { env: { ...process.env, AXIOM_DATA_DIR: root } }).catch(error => {
      const reply = JSON.parse(error.stdout); assert.equal(reply.state, "error"); throw Error(reply.message);
    });
    return JSON.parse(result.stdout);
  };
  try {
    const budgets = { ...budgetsDefault, totalMs: budgetsDefault.totalMs + 1000 };
    await control("extend", { id, budgets });
    let status = await updater.status(); const deadline = Date.now() + 3000;
    while (status.job.task.budgets.totalMs !== budgets.totalMs && Date.now() < deadline) { await delay(30); status = await updater.status(); }
    assert.equal(status.job.task.budgets.totalMs, budgets.totalMs);
    await assert.rejects(control("extend", { id, budgets: budgetsDefault }), /只能延长/);
    await assert.rejects(control("cancel", { id: "stale" }), /身份已变化/);
    await control("cancel", { id });
    const result = await work;
    assert.equal(result.job.running, false);
    assert.equal(result.job.task.status, "cancelled");
    assert.equal(result.job.task.error.code, "cancelled");
    await assert.rejects(control("cancel", { id }), /任务已结束/);
  } finally {
    await updater.maintenanceControl("cancel", { id }).catch(() => {}); await work;
  }
});
