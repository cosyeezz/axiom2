import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "axiom-inspection-"));
  const previousRoot = process.env.AXIOM_DATA_DIR;
  const previousPort = process.env.AXIOM_PORT;
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  process.env.AXIOM_PORT = String((probe.address() as { port: number }).port);
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  process.env.AXIOM_DATA_DIR = root;
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.AXIOM_DATA_DIR;
    else process.env.AXIOM_DATA_DIR = previousRoot;
    if (previousPort === undefined) delete process.env.AXIOM_PORT;
    else process.env.AXIOM_PORT = previousPort;
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const url = new URL("../../bin/service.mjs", import.meta.url);
  url.searchParams.set("fixture", root);
  return { root, service: await import(url.href) };
}

test("initial control failure cannot confirm stop while the recorded process is still cleaning up", { timeout: 15000 }, async (t) => {
  const { root, service } = await fixture(t);
  const token = "b".repeat(64);
  const descriptor = join(root, "service-control.json");
  await writeFile(descriptor, JSON.stringify({ port: 12345, token, pid: process.pid }));
  const cleanupEntered = deferred();
  const releaseCleanup = deferred();
  t.signal.addEventListener("abort", () => releaseCleanup.resolve(), { once: true });
  let first = true;
  let stopRequested = false;
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    if (first) { first = false; throw new TypeError("initial control request reset during shutdown"); }
    if (options.method === "POST") {
      stopRequested = true;
      return new Response(JSON.stringify({ instance: token, state: "stopping", active: [] }));
    }
    cleanupEntered.resolve();
    await releaseCleanup.promise;
    await rm(descriptor, { force: true });
    throw new TypeError("cleanup completed and control listener closed");
  });
  let settled = false;
  const stopping = service.stop({ timeoutMs: 5000 });
  void stopping.then(() => { settled = true; }, () => { settled = true; });
  try {
    await Promise.race([
      cleanupEntered.promise,
      stopping.then(() => { throw Error("stop returned before cleanup was released"); }),
    ]);
    assert.equal(stopRequested, true, "initial failure must preserve a manageable instance");
    assert.equal(settled, false, "a live descriptor PID is not evidence that shutdown completed");
    releaseCleanup.resolve();
    assert.equal((await stopping).state, "stopped");
  } finally {
    releaseCleanup.resolve();
    await stopping.catch(() => {});
  }
});

test("reclaiming a dead launcher snapshot preserves a reservation handed off to a live child", { timeout: 15000 }, async (t) => {
  const { root, service } = await fixture(t);
  const token = "c".repeat(64);
  const oldPid = 2_000_000_000;
  const path = join(root, "service-startup.sqlite");
  const db = new DatabaseSync(path);
  try {
    db.exec("CREATE TABLE startup (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL, pid INTEGER NOT NULL)");
    db.prepare("INSERT INTO startup VALUES (1,?,?)").run(token, oldPid);
  } finally { db.close(); }
  const cancellation = join(root, `service-cancel-${token}`);
  await writeFile(cancellation, "");
  const originalKill = process.kill;
  t.mock.method(process, "kill", (...args: Parameters<typeof process.kill>) => {
    const [pid, signal] = args;
    assert.equal(signal, 0, "persisted PIDs may only be probed for liveness");
    if (pid === oldPid) throw Object.assign(Error("launcher exited"), { code: "ESRCH" });
    return originalKill(...args);
  });
  let handedOff = false;
  const originalPrepare = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype, "prepare", function (this: DatabaseSync, sql: string) {
    const statement = originalPrepare.call(this, sql);
    if (!handedOff && sql === "SELECT token,pid FROM startup WHERE id=1") {
      // Capture the launcher's old row, then commit its child PID before inspect
      // resumes. This fixes the otherwise timing-dependent handoff interleaving.
      const snapshot = statement.get();
      handedOff = true;
      this.exec(`UPDATE startup SET pid=${process.pid} WHERE id=1`);
      t.mock.method(statement, "get", () => snapshot);
    }
    return statement;
  });
  assert.equal((await service.status()).state, "starting");
  assert.equal(handedOff, true);
  const current = new DatabaseSync(path);
  try { assert.equal(current.prepare("SELECT pid FROM startup WHERE id=1").get()?.pid, process.pid); }
  finally { current.close(); }
  assert.ok(await stat(cancellation), "handoff must retain the pending cancellation marker");
});
