import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const { createUpdater } = await import(new URL("../desktop/updater.mjs", import.meta.url).href);
const { desktopTask } = await import(new URL("../desktop/maintenance.mjs", import.meta.url).href);
async function fixture(t: TestContext, running = false) {
  const root = await mkdtemp(join(tmpdir(), "axiom-supervision-history-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const updater = createUpdater({ root, isAlive: () => true, command: async () => { throw Error("unexpected command"); }, fetcher: async () => { throw Error("unexpected network"); } });
  await updater.history();
  const task = { ...desktopTask("client", "download"), status: running ? "running" : "succeeded", capabilities: { cancel: running, extend: running } };
  const directory = join(root, "updates", "tasks", task.id);
  await mkdir(directory, { recursive: true });
  const sidecar = join(directory, "task.json");
  await writeFile(sidecar, JSON.stringify(task));
  const body = { task, supervised: true, kind: "client", running, phase: running ? "downloading" : "ready", asset: { sha256: "a".repeat(64), size: 1 }, installer: join(root, "updates", `${"a".repeat(64)}-Axiom2.msi`) };
  const db = new DatabaseSync(join(root, "updates/jobs.sqlite"));
  try { db.prepare("INSERT INTO job VALUES(1,?,?,?)").run(task.id, process.pid, JSON.stringify(body)); }
  finally { db.close(); }
  return { updater, root, task, sidecar };
}

test("invalidated desktop installer stays failed despite an older successful sidecar", async t => {
  const f = await fixture(t);
  const before = await readFile(f.sidecar, "utf8");
  await assert.rejects(f.updater.installer(), /安装包已变化或不可用/);
  const history = await f.updater.history();
  assert.equal(history.tasks[0].status, "failed");
  assert.equal(history.tasks[0].error.code, "operation");
  assert.equal(await readFile(f.sidecar, "utf8"), before);
});

test("an unfinished parent gate prevents success and reentry after terminal SQLite publication", async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, "updates/process-owner.json"), "retained parent evidence");
  const history = await f.updater.history();
  assert.equal(history.tasks[0].status, "unknown");
  assert.equal(history.tasks[0].error.code, "stop-unconfirmed");
  assert.deepEqual(history.tasks[0].capabilities, { cancel: false, extend: false });
  assert.equal((await f.updater.busy()).busy, true);
  await assert.rejects(f.updater.runJob("check"), /归属记录已保留/);
  assert.equal(await readFile(join(f.root, "updates/process-owner.json"), "utf8"), "retained parent evidence");
});

test("a mismatched active sidecar becomes unknown without rewriting either record", async t => {
  const f = await fixture(t, true);
  const wrong = JSON.stringify({ ...f.task, attemptId: "another-attempt" });
  await writeFile(f.sidecar, wrong);
  const history = await f.updater.history();
  assert.equal(history.tasks[0].status, "unknown");
  assert.deepEqual(history.tasks[0].capabilities, { cancel: false, extend: false });
  assert.equal(await readFile(f.sidecar, "utf8"), wrong);
  await assert.rejects(f.updater.maintenanceControl("cancel", { id: f.task.id }), /此阶段无法取消/);
});
