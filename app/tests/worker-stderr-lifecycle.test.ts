import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Socket } from "node:net";
import type { ChildProcess } from "node:child_process";
import { ExecutionPool } from "../src/server/execution-pool.js";
import type { PreparedEnvironment, WorkerEntry } from "../src/server/execution-profile.js";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 5_000);
    })]);
  } finally { clearTimeout(timer); }
}

// Request independent helper lifetime, then verify survival with a post-exit
// ping. The helper exits if its private control connection closes or fails.
const fixture = String.raw`
const net = require('node:net');
const { spawn } = require('node:child_process');
const nonce = process.env.AXIOM_FIXTURE_NONCE;
function frames(socket, receive) {
  let rest = ''; socket.setEncoding('utf8');
  socket.on('data', chunk => {
    rest += chunk;
    while (rest.includes('\n')) {
      const at = rest.indexOf('\n'), line = rest.slice(0, at); rest = rest.slice(at + 1);
      if (line) receive(JSON.parse(line));
    }
  });
}
if (process.argv[2] === 'helper') {
  const socket = net.connect(Number(process.env.AXIOM_FIXTURE_PORT), '127.0.0.1');
  socket.on('connect', () => socket.write(JSON.stringify({ type: 'ready', nonce, pid: process.pid }) + '\n'));
  socket.on('error', () => process.exit(2));
  socket.on('close', () => process.exit(0));
  frames(socket, value => {
    if (value.nonce !== nonce) return;
    if (value.type === 'ping') socket.write(JSON.stringify({ type: 'pong', nonce, id: value.id }) + '\n');
    if (value.type === 'release') socket.end();
  });
} else {
  let lease;
  process.on('message', value => {
    if (value.type === 'shutdown' && value.instance?.instanceId === process.env.AXIOM_EXECUTION_INSTANCE &&
        value.instance?.generation === Number(process.env.AXIOM_EXECUTION_GENERATION) &&
        value.instance?.profileHash === process.env.AXIOM_EXECUTION_PROFILE) process.exit(0);
    if (value.nonce !== nonce) return;
    if (value.type === 'spawn_helper') {
      const helper = spawn(process.execPath, [__filename, 'helper'], {
        env: process.env, detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'inherit'],
      });
      helper.on('error', () => process.exit(3)); helper.unref();
    }
    if (value.type === 'announce') {
      lease = value.lease;
      process.send({ type: 'done', lease: value.lease, status: 'completed' });
      process.send({ type: 'closed', lease: value.lease });
      process.send({ type: 'fixture_held', nonce });
    }
    if (value.type === 'exit') process.send({ type: 'usage', nonce, lease, usage: { inputTokens: 1, outputTokens: 1 } }, () => process.exit(0));
  });
  process.send({ type: 'process_ready', instance: {
    instanceId: process.env.AXIOM_EXECUTION_INSTANCE,
    generation: Number(process.env.AXIOM_EXECUTION_GENERATION),
    profileHash: process.env.AXIOM_EXECUTION_PROFILE,
  } });
}
`;

for (const entry of ["agent", "memory"] satisfies WorkerEntry[]) {
  test(`${entry} pool settles native close without waiting for discarded inherited stderr`, { timeout: 20_000 }, async t => {
    const root = mkdtempSync(join(tmpdir(), "pool-stderr-")), nonce = randomUUID();
    const home = join(root, "home"), pi = join(root, "pi"), native = join(root, "native");
    for (const directory of [home, pi, native]) mkdirSync(directory);
    const workerPath = join(root, "fixture.cjs"); writeFileSync(workerPath, fixture);
    const ready = deferred(), helperClosed = deferred(), held = deferred();
    const pings = new Map<string, { resolve: (value: void) => void }>();
    const sockets = new Set<Socket>();
    let helper: Socket | undefined, stopping = false, references = 0, releases = 0;
    const send = (socket: Socket, value: Record<string, unknown>) => socket.write(JSON.stringify({ ...value, nonce }) + "\n");
    const server = createServer(socket => {
      if (stopping) { socket.destroy(); return; }
      sockets.add(socket); socket.on("error", () => {});
      socket.on("close", () => { sockets.delete(socket); if (socket === helper) helperClosed.resolve(); });
      let rest = ""; socket.setEncoding("utf8");
      socket.on("data", chunk => {
        rest += chunk;
        while (rest.includes("\n")) {
          const at = rest.indexOf("\n"), line = rest.slice(0, at); rest = rest.slice(at + 1);
          if (!line) continue;
          const value = JSON.parse(line);
          if (value.nonce !== nonce) { socket.destroy(); continue; }
          if (value.type === "ready") {
            helper = socket; ready.resolve();
            if (stopping) send(socket, { type: "release" });
          }
          if (value.type === "pong") pings.get(value.id)?.resolve();
        }
      });
    });
    const pool = new ExecutionPool({ targetReadyTotal: 0, prepareTimeoutMs: 5_000 }, "managed");
    let child: ChildProcess | undefined, closed: Promise<[number | null, NodeJS.Signals | null]> | undefined;
    let failure: unknown;
    try {
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
      const address = server.address(); assert.ok(address && typeof address !== "string");
      const env: NodeJS.ProcessEnv = {
        HOME: home, USERPROFILE: home, TMP: root, TEMP: root, TMPDIR: root,
        AXIOM_PI_DIR: pi, PI_CODING_AGENT_DIR: native, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1",
        AXIOM_FIXTURE_NONCE: nonce, AXIOM_FIXTURE_PORT: String(address.port),
      };
      for (const key of ["SystemRoot", "WINDIR", "ComSpec", "PATHEXT"]) if (process.env[key]) env[key] = process.env[key];
      const environment: PreparedEnvironment = {
        profileHash: nonce, entry, reuse: "single-use", environmentWarm: false,
        cwd: root, root, modelDir: pi, modelsFile: join(pi, "models.json"), workerPath, execArgv: [], env, configRevision: "1",
        current: () => true, snapshotValid: () => true,
        retain: () => { references++; }, release: () => { references--; releases++; },
      };
      const lease = await pool.acquire({ environment, kind: entry === "memory" ? "memory-query" : "agent",
        signal: t.signal, requestStartedAtMonoMs: performance.now() });
      child = await lease.ensureReady();
      const exited = new Promise<[number | null, NodeJS.Signals | null]>(resolve => child!.once("exit", (code, signal) => resolve([code, signal])));
      closed = new Promise(resolve => child!.once("close", (code, signal) => resolve([code, signal])));
      let released = false; void lease.released.then(() => { released = true; });
      const tailUsage: unknown[] = [];
      child.on("message", value => {
        const event = value as { type?: string; nonce?: string };
        if (event.nonce !== nonce) return;
        if (event.type === "fixture_held") held.resolve();
        if (event.type === "usage") tailUsage.push(value);
      });
      const ping = async () => {
        const id = randomUUID(), response = deferred(); pings.set(id, response);
        try { assert.ok(helper && !helper.destroyed); send(helper, { type: "ping", id }); await bounded(response.promise, "owned helper did not answer ping"); }
        finally { pings.delete(id); }
      };
      child.send({ type: "spawn_helper", nonce }); await bounded(ready.promise, "owned helper did not register");
      child.send({ type: "announce", nonce, lease: lease.ref }); await bounded(held.promise, "worker did not confirm done/closed while alive");
      assert.equal(released, false, "IPC completion is not a native process close");
      assert.equal(pool.stats().leased, 1); assert.equal(pool.stats().total, 1); assert.equal(references, 2);
      child.send({ type: "exit", nonce });
      assert.deepEqual(await bounded(exited, "worker did not exit"), [0, null]);
      await ping();
      assert.deepEqual(await bounded(closed, "native close must not wait for an unused stderr pipe held by the owned helper"), [0, null]);
      await bounded(lease.released, "native close did not release the lease");
      await ping(); // Helper remains alive after the actual close and lease release.
      assert.equal(pool.stats().total, 0); assert.equal(pool.stats().leased, 0);
      assert.equal(references, 1, "only the recent-profile reference remains"); assert.equal(releases, 1);
      assert.deepEqual(tailUsage, [{ type: "usage", nonce, lease: lease.ref, usage: { inputTokens: 1, outputTokens: 1 } }], "close preserves IPC usage sent after closed");
    } catch (error) { failure = error; }
    finally {
      stopping = true;
      const cleanupErrors: unknown[] = [];
      const cleanup = async (action: () => void | Promise<unknown>) => {
        try { await action(); } catch (error) { cleanupErrors.push(error); }
      };
      await cleanup(async () => {
        if (helper && !helper.destroyed) {
          send(helper, { type: "release" });
          await bounded(helperClosed.promise, "owned helper did not disconnect");
        }
      });
      // Even a failed handshake/release must disconnect late authenticated helpers.
      for (const socket of sockets) socket.destroy();
      await cleanup(async () => {
        if (!child) return;
        const killOwned = () => { if (child!.exitCode === null && child!.signalCode === null) child!.kill("SIGKILL"); };
        if (child.exitCode === null && child.signalCode === null) {
          try { child.send({ type: "exit", nonce }, error => { if (error) killOwned(); }); }
          catch { killOwned(); }
        }
        if (closed) {
          try { await bounded(closed, "owned worker did not close during cleanup"); }
          catch (error) {
            killOwned();
            await cleanup(() => bounded(closed!, "owned worker did not close after termination"));
            throw error;
          }
        }
      });
      await cleanup(() => bounded(pool.close(), "owned pool did not close during cleanup"));
      await cleanup(() => {
        assert.equal(references, 0);
        assert.equal(releases, 2, "instance and recent-profile references each release exactly once");
      });
      await cleanup(async () => {
        if (!server.listening) return;
        const serverClosed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        try { await bounded(serverClosed, "owned control server did not close"); }
        catch (error) {
          for (const socket of sockets) socket.destroy();
          await cleanup(() => bounded(serverClosed, "owned control server did not close after socket destruction"));
          throw error;
        }
      });
      // Socket close can precede helper OS teardown; retry only filesystem failures.
      await cleanup(() => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
      if (cleanupErrors.length) failure = new AggregateError([...(failure ? [failure] : []), ...cleanupErrors], "worker assertion or cleanup failed");
    }
    if (failure) throw failure;
  });
}
