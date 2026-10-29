import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const { createUpdater } = await import(new URL("../desktop/updater.mjs", import.meta.url).href);
const { desktopTask } = await import(new URL("../desktop/maintenance.mjs", import.meta.url).href);
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "axiom-update-history-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  let requests = 0, fail = false;
  const updater = createUpdater({ root, isAlive: (pid: number) => pid === process.pid,
    command: async () => { throw Error("history must not run commands"); },
    fetcher: async () => { requests++; if (fail) throw Error("fixture network failure"); return new Response(JSON.stringify({ tag_name: "v0.4.2", assets: [{ name: "axiom2.tgz", size: 1, digest: `sha256:${"a".repeat(64)}`, browser_download_url: "https://github.com/cosyeezz/axiom2/releases/download/v0.4.2/axiom2.tgz" }] })); },
  });
  await updater.history();
  const database = (fn: (db: DatabaseSync) => void) => { const db = new DatabaseSync(join(root, "updates/jobs.sqlite")); try { fn(db); } finally { db.close(); } };
  const seed = (id: string, status: string, createdAt: number, current = false, pid = -1) => {
    const task = { ...desktopTask("check", "check"), id, status, createdAt, capabilities: { cancel: true, extend: true } };
    const body = JSON.stringify({ task, kind: "check", running: status === "running" || status === "cancelling", phase: status === "succeeded" ? "complete" : "checking" });
    database(db => { db.prepare("INSERT INTO maintenance_history VALUES(?,?,?)").run(id, pid, body); if (current) db.prepare("INSERT OR REPLACE INTO job VALUES(1,?,?,?)").run(id, pid, body); });
  };
  async function installRecord() {
    const packageRoot = join(root, "prefix/node_modules/@cosyeezz/axiom2");
    await mkdir(join(packageRoot, "bin"), { recursive: true });
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "@cosyeezz/axiom2", version: "0.4.1" }));
    await writeFile(join(root, "installation.json"), JSON.stringify({ node: process.execPath, cli: join(packageRoot, "bin/axiom2.mjs") }));
  }
  return { root, updater, database, seed, installRecord, requests: () => requests, fail: () => { fail = true; } };
}

test("desktop update history retains successive actual tasks across a new reader without replay", async t => {
  const f = await fixture(t); await f.installRecord();
  const first = await f.updater.runJob("check"); f.fail();
  const second = await f.updater.runJob("check");
  const requestsBeforeHistory = f.requests();
  const reader = createUpdater({ root: f.root, command: async () => { throw Error("unexpected command"); }, fetcher: async () => { throw Error("unexpected network"); } });
  const history = await reader.history();
  assert.equal(history.error, null);
  assert.deepEqual(history.tasks.map((task: any) => [task.id, task.status]), [[first.job.task.id, "succeeded"], [second.job.task.id, "failed"]]);
  assert.equal(f.requests(), requestsBeforeHistory, "history does not replay latest or platform-history discovery");
  assert.ok(history.tasks.every((task: any) => !task.capabilities.cancel && !task.capabilities.extend));
  await assert.rejects(reader.maintenanceControl("cancel", { id: first.job.task.id }), /任务已结束|身份已变化/);
});

test("history reads legacy singleton without changing it and marks dead tasks interrupted", async t => {
  const f = await fixture(t); f.seed("old-task", "running", 1, true);
  f.database(db => db.exec("DELETE FROM maintenance_history"));
  let before: unknown;
  f.database(db => { before = db.prepare("SELECT * FROM job").get(); });
  const history = await f.updater.history();
  assert.equal(history.tasks[0].status, "interrupted");
  assert.deepEqual(history.tasks[0].capabilities, { cancel: false, extend: false });
  f.database(db => assert.deepEqual(db.prepare("SELECT * FROM job").get(), before));
  assert.equal(f.requests(), 0);
});

test("history preserves unreadable rows and reads valid records with a broken current singleton", async t => {
  const f = await fixture(t); f.seed("valid", "succeeded", 1);
  f.database(db => { db.prepare("INSERT INTO maintenance_history VALUES(?,?,?)").run("broken", -1, "broken bytes"); db.prepare("INSERT INTO job VALUES(1,?,?,?)").run("pointer", -1, "bad pointer"); });
  const history = await f.updater.history();
  assert.deepEqual(history.tasks.map((task: any) => task.id), ["valid"]);
  assert.match(history.error, /2 条/);
  f.database(db => { assert.equal(db.prepare("SELECT body FROM maintenance_history WHERE token='broken'").get()!.body, "broken bytes"); assert.equal(db.prepare("SELECT body FROM job").get()!.body, "bad pointer"); });
});

test("history disables archived controls even when an unrelated process reuses the pid", async t => {
  const f = await fixture(t); f.seed("archived", "running", 1, false, process.pid); f.seed("current", "running", 2, true, process.pid);
  const history = await f.updater.history();
  assert.equal(history.tasks[0].status, "interrupted"); assert.equal(history.tasks[0].capabilities.cancel, false);
  assert.equal(history.tasks[1].status, "running"); assert.equal(history.tasks[1].capabilities.cancel, true);
});

test("history keeps unresolved records and only the latest 100 ordinary terminal tasks", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 103; i++) f.seed(`complete-${i}`, "succeeded", i + 10);
  f.seed("old-unknown", "unknown", 1); f.seed("old-interrupted", "interrupted", 2);
  const history = await f.updater.history();
  assert.equal(history.tasks.length, 102);
  assert.deepEqual(history.tasks.slice(0, 2).map((task: any) => task.id), ["old-unknown", "old-interrupted"]);
  assert.equal(history.tasks[2].id, "complete-3");
  f.database(db => assert.equal(db.prepare("SELECT count(*) AS count FROM maintenance_history").get()!.count, 105));
});

test("new task publication prunes only completed history and preserves damaged and unresolved rows", async t => {
  const f = await fixture(t); await f.installRecord();
  for (let i = 0; i < 103; i++) f.seed(`complete-${i}`, "succeeded", i + 10);
  f.seed("old-unknown", "unknown", 1);
  f.database(db => db.prepare("INSERT INTO maintenance_history VALUES(?,?,?)").run("damaged", -1, "original broken bytes"));
  await f.updater.runJob("check");
  const history = await f.updater.history();
  assert.equal(history.tasks.length, 101); assert.match(history.error, /1 条/);
  assert.equal(history.tasks[0].id, "old-unknown");
  f.database(db => { assert.equal(db.prepare("SELECT count(*) AS count FROM maintenance_history").get()!.count, 102); assert.equal(db.prepare("SELECT body FROM maintenance_history WHERE token='damaged'").get()!.body, "original broken bytes"); });
});

test("history pruning preserves valid JSON whose terminal task is incomplete", async t => {
  const f = await fixture(t); await f.installRecord();
  const partial = JSON.stringify({ task: { id: "partial", status: "succeeded", createdAt: 0 } });
  f.database(db => db.prepare("INSERT INTO maintenance_history VALUES(?,?,?)").run("partial", -1, partial));
  assert.match((await f.updater.history()).error, /1 条/);
  for (let i = 0; i < 101; i++) f.seed(`valid-${i}`, "succeeded", i + 1);
  await f.updater.runJob("check");
  const history = await f.updater.history();
  assert.equal(history.tasks.length, 100); assert.match(history.error, /1 条/);
  f.database(db => assert.equal(db.prepare("SELECT body FROM maintenance_history WHERE token='partial'").get()!.body, partial));
});
