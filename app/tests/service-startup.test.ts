import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { createServer, createConnection } from "node:net";
import { mkdtemp, copyFile, mkdir, writeFile, stat, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "axiom-startup-"));
  const data = join(directory, "data");
  await mkdir(data);
  await copyFile(new URL("../../bin/service.mjs", import.meta.url), join(directory, "service.mjs"));
  await copyFile(new URL("./fixtures/service-startup-cli.mjs", import.meta.url), join(directory, "axiom2.mjs"));
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const command = (action: string, timeoutMs = 15000) => new Promise<any>((resolve) => {
    execFile(process.execPath, [join(directory, "axiom2.mjs"), action], {
      env: { ...process.env, AXIOM_DATA_DIR: data, AXIOM_PORT: String(port), TEST_CONTROL_TIMEOUT: String(timeoutMs) }, timeout: 25000,
    }, (error, stdout, stderr) => {
      try { resolve({ ...JSON.parse(stdout.trim()), failed: !!error }); }
      catch { resolve({ state: "error", failed: true, message: String(error || stderr || stdout) }); }
    });
  });
  const exists = async (name: string) => { try { await stat(join(data, name)); return true; } catch { return false; } };
  const release = (name: string) => writeFile(join(data, name), "");
  const wait = async (name: string) => {
    const deadline = Date.now() + 10000;
    while (!await exists(name)) { if (Date.now() > deadline) throw Error(`Missing ${name}`); await delay(25); }
  };
  const listening = () => new Promise<boolean>((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const finish = (value: boolean) => { socket.destroy(); resolve(value); };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
  const close = async () => {
    await release("bootstrap-gate"); await release("initialize-gate");
    await command("stop");
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
  return { data, command, exists, release, wait, listening, close };
}

test("stop before the control listener cancels the reserved detached launch", { timeout: 40000 }, async () => {
  const f = await fixture();
  try {
    const starting = f.command("start");
    await f.wait("child-entered");
    assert.equal((await f.command("status")).state, "starting");
    let finished = false;
    const stopping = f.command("stop").then((value) => { finished = true; return value; });
    // The persisted cancellation proves stop has entered before releasing bootstrap.
    const { readdir } = await import("node:fs/promises");
    const deadline = Date.now() + 10000;
    while (!(await readdir(f.data)).some((name) => name.startsWith("service-cancel-"))) {
      if (Date.now() > deadline) throw Error("Stop did not register cancellation");
      await delay(20);
    }
    assert.equal(finished, false);
    assert.equal(await f.listening(), false);
    await f.release("bootstrap-gate");
    assert.equal((await stopping).state, "stopped");
    assert.equal((await starting).failed, true);
    assert.equal(await f.exists("initializing"), false);
    await f.release("initialize-gate");
    assert.equal(await f.exists("listened"), false);
    assert.equal((await f.command("status")).state, "stopped");
  } finally { await f.close(); }
});

test("stop during initialization waits for cleanup and cannot be followed by a late running service", { timeout: 40000 }, async () => {
  const f = await fixture();
  try {
    await f.release("bootstrap-gate");
    const starting = f.command("start");
    await f.wait("initializing");
    assert.equal((await f.command("status")).state, "starting");
    let finished = false;
    const stopping = f.command("stop").then((value) => { finished = true; return value; });
    const deadline = Date.now() + 10000;
    while ((await f.command("status")).state !== "stopping") {
      if (Date.now() > deadline) throw Error("Stop was not accepted during initialization");
      await delay(20);
    }
    assert.equal(finished, false);
    await f.release("initialize-gate");
    assert.equal((await stopping).state, "stopped");
    assert.equal((await starting).failed, true);
    assert.equal(await f.exists("closed"), true);
    assert.equal(await f.listening(), false);
    assert.equal((await f.command("status")).state, "stopped");
  } finally { await f.close(); }
});

test("a timed out start remains observable and stoppable while initialization continues", { timeout: 40000 }, async () => {
  const f = await fixture();
  try {
    await f.release("bootstrap-gate");
    const starting = f.command("start", 1000);
    await f.wait("initializing");
    const result = await starting;
    assert.equal(result.failed, true);
    assert.match(result.message, /仍在启动/);
    assert.equal((await f.command("status")).state, "starting");
    const stopping = f.command("stop");
    const deadline = Date.now() + 10000;
    while ((await f.command("status")).state !== "stopping") {
      if (Date.now() > deadline) throw Error("Timed out launch became unmanageable");
      await delay(20);
    }
    await f.release("initialize-gate");
    assert.equal((await stopping).state, "stopped");
    assert.equal(await f.listening(), false);
  } finally { await f.close(); }
});

test("concurrent starters share one startup reservation and one service instance", { timeout: 40000 }, async () => {
  const f = await fixture();
  try {
    await f.release("bootstrap-gate");
    const first = f.command("start");
    await f.wait("initializing");
    const second = f.command("start");
    await f.release("initialize-gate");
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.state, "running", a.message);
    assert.equal(b.state, "running", b.message);
    assert.equal(a.pid, b.pid);
    assert.equal(a.pid, Number(await readFile(join(f.data, "child-entered"), "utf8")));
    assert.equal((await f.command("stop")).state, "stopped");
  } finally { await f.close(); }
});
