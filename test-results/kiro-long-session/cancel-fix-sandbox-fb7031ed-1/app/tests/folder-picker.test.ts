import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "./temporary.js";
import { join } from "node:path";
import { request } from "node:http";
import { randomUUID } from "node:crypto";
import { FolderPicker, FolderPickerError, folderPickerCommands, nativeFolderPicker, type PickFolder } from "../src/server/folder-picker.js";
import { startServer } from "../src/server/index.js";
import { windowsOpenSource } from "../src/server/open-dialog-scripts.js";

function fakeProcess() {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null });
  const kills: (NodeJS.Signals | number | undefined)[] = [];
  child.kill = (signal) => {
    kills.push(signal);
    queueMicrotask(() => { Object.assign(child, { signalCode: "SIGKILL" }); child.emit("close", null); });
    return true;
  };
  return { child, kills };
}

const signal = () => new AbortController().signal;

test("native commands use a prepared Windows STA GUI host, macOS AppKit and Linux GTK", () => {
  const windows = folderPickerCommands("win32")[0];
  assert.equal(windows.file, "AxiomOpen.exe");
  assert.deepEqual(windows.args, []);
  assert.match(windowsOpenSource, /\[STAThread\]/);
  assert.match(windowsOpenSource, /UTF8Encoding\(false\)/);
  assert.match(windowsOpenSource, /IFileOpenDialog/);
  assert.match(windowsOpenSource, /AXIOM_OPEN_OPTIONS/);
  assert.doesNotMatch(windowsOpenSource, /FolderBrowserDialog|System.Windows.Forms/);
  const mac = folderPickerCommands("darwin")[0];
  assert.equal(mac.file, "/usr/bin/osascript");
  assert.match(mac.args.at(-1)!, /NSOpenPanel/);
  assert.deepEqual(folderPickerCommands("linux").map((c) => c.file), ["python3"]);
  assert.throws(() => folderPickerCommands("freebsd"), { status: 503 });
});

test("native picker preserves UTF-8 chunk boundaries, spaces and metacharacters with shell disabled", async () => {
  const { child } = fakeProcess();
  const path = "C:\\中文😀\\项目 & $(test) ' 尾空格 ";
  const picker = nativeFolderPicker({ platform: "win32", spawn: (_file, _args, options) => {
    assert.equal(options.shell, false);
    assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
    queueMicrotask(() => {
      for (const byte of Buffer.from(JSON.stringify([path]) + "\r\n")) child.stdout!.emit("data", Buffer.from([byte]));
      child.emit("close", 0);
    });
    return child;
  } });
  assert.equal(await picker(signal()), path);
});

test("native cancellation and failure are distinct on each platform", async () => {
  for (const [platform, code, output, error, expected] of [
    ["win32", 0, "[]", "", null],
    ["darwin", 0, "[]\n", "", null],
    ["linux", 0, "[]", "", null],
    ["linux", 1, "", "cannot open display", "error"],
    ["darwin", 1, "", "execution error", "error"],
    ["win32", 1, "", "PowerShell error", "error"],
  ] as const) {
    const { child } = fakeProcess();
    const picker = nativeFolderPicker({ platform, spawn: () => {
      queueMicrotask(() => {
        child.stdout!.emit("data", Buffer.from(output));
        child.stderr!.emit("data", Buffer.from(error));
        child.emit("close", code);
      });
      return child;
    } });
    if (expected === "error") await assert.rejects(picker(signal()), { status: 500 });
    else assert.equal(await picker(signal()), null);
  }
});

test("Linux reports missing desktop dependencies without silently changing selection semantics", async () => {
  await assert.rejects(nativeFolderPicker({ platform: "linux", spawn: () => {
    throw Object.assign(Error("missing"), { code: "ENOENT" });
  } })(signal()), { status: 503, message: /Python 3、PyGObject 和 GTK 3/ });
});

test("native invalid UTF-8, output limits and process abort clean up owned children", async () => {
  const listeners = process.listenerCount("exit");
  for (const bytes of [Buffer.from([0xff]), Buffer.alloc(1024 * 1024 + 1, 65)]) {
    const { child, kills } = fakeProcess();
    const picker = nativeFolderPicker({ platform: "win32", spawn: () => {
      queueMicrotask(() => { child.stdout!.emit("data", bytes); if (bytes.length === 1) child.emit("close", 0); });
      return child;
    } });
    await assert.rejects(picker(signal()), { status: 500 });
    assert.equal(kills.length, bytes.length === 1 ? 0 : 1);
  }
  const { child, kills } = fakeProcess(), controller = new AbortController();
  const pending = nativeFolderPicker({ platform: "win32", spawn: () => child })(controller.signal);
  controller.abort(new FolderPickerError("aborted", 499));
  await assert.rejects(pending, { status: 499 });
  assert.deepEqual(kills, ["SIGKILL"]);
  assert.equal(process.listenerCount("exit"), listeners);
});

test("abort terminates an actual owned process without opening a desktop dialog", { timeout: 5000 }, async () => {
  let child: ChildProcess | undefined;
  const controller = new AbortController();
  const picker = nativeFolderPicker({ platform: "win32", spawn: (_file, _args, options) => {
    child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], options);
    return child;
  } });
  const pending = picker(controller.signal);
  controller.abort(new FolderPickerError("aborted", 499));
  await assert.rejects(pending, { status: 499 });
  assert.ok(child);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test("service picker serializes selection and validates real directories", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-picker-path-"));
  const directory = join(root, "中文 空格 & 项目");
  mkdirSync(directory);
  const file = join(root, "file"); writeFileSync(file, "test");
  let finish!: (path: string | null) => void;
  const picker = new FolderPicker(() => new Promise((resolve) => { finish = resolve; }));
  try {
    const first = picker.select(signal());
    await Promise.resolve();
    await assert.rejects(picker.select(signal()), { status: 409 });
    finish(directory);
    assert.equal(await first, realpathSync(directory));
    const second = picker.select(signal()); await Promise.resolve(); finish(null);
    assert.equal(await second, null);
    for (const path of ["relative", file, join(root, "missing"), directory + "\0"]) {
      const invalid = new FolderPicker(async () => path);
      await assert.rejects(invalid.select(signal()), { status: 400 });
      await invalid.close();
    }
  } finally {
    await picker.close(); rmSync(root, { recursive: true, force: true });
  }
});

test("timeout, request abort and service close stop their native dialog before releasing the slot", async () => {
  for (const action of ["timeout", "abort", "close"] as const) {
    const { child, kills } = fakeProcess();
    const picker = new FolderPicker(nativeFolderPicker({ platform: "win32", spawn: () => child }), action === "timeout" ? 10 : 1000);
    const controller = new AbortController();
    const pending = picker.select(controller.signal);
    const rejected = assert.rejects(pending, { status: action === "timeout" ? 504 : action === "abort" ? 499 : 503 });
    await Promise.resolve();
    // Keep the test alive while the production timeout remains correctly unref'd.
    const hold = setTimeout(() => {}, 1000);
    try {
      if (action === "abort") controller.abort();
      if (action === "close") await picker.close();
      await rejected;
      assert.deepEqual(kills, ["SIGKILL"]);
      await picker.close();
      await assert.rejects(picker.select(signal()), { status: 503 });
    } finally { clearTimeout(hold); }
  }
});

test("HTTP folder selection: strict origin/host/method, JSON result/errors, concurrency, disconnect and shutdown", { timeout: 30000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-picker-http-")), pi = join(root, "pi"), directory = join(root, "中文 项目");
  mkdirSync(pi); mkdirSync(directory);
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = pi;
  let calls = 0, activeSignal: AbortSignal | undefined, started: (() => void) | undefined;
  let implementation: PickFolder = async () => directory;
  const app = await startServer({ root, port: 0, pickFolder: (s) => {
    calls++; activeSignal = s; started?.(); return implementation(s);
  } });
  let closed = false;
  const url = app.origin + "/api/workspace/pick-folder";
  const post = (headers: Record<string, string> = { Origin: app.origin }) => fetch(url, { method: "POST", headers });
  const waiting: PickFolder = (s) => new Promise((_resolve, reject) => {
    s.addEventListener("abort", () => reject(s.reason), { once: true });
  });
  try {
    const rejectedHeaders: Record<string, string>[] = [{}, { Origin: "null" }, { Origin: "https://evil.example" }, { Origin: app.origin, Host: "evil.example" }, { Origin: app.origin, "Sec-Fetch-Site": "cross-site" }];
    for (const headers of rejectedHeaders) {
      // fetch normalizes forbidden headers such as Host; raw HTTP tests the actual guard.
      await new Promise<void>((resolve, reject) => {
        const req = request(url, { method: "POST", headers }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            try {
              assert.equal(res.statusCode, 403, JSON.stringify(headers));
              assert.equal(typeof JSON.parse(Buffer.concat(chunks).toString("utf8")).error, "string");
              resolve();
            } catch (error) { reject(error); }
          });
        });
        req.on("error", reject); req.end();
      });
    }
    assert.equal(calls, 0);
    const method = await fetch(url, { headers: { Origin: app.origin } });
    assert.equal(method.status, 405); assert.equal(method.headers.get("allow"), "POST");
    assert.equal(typeof (await method.json()).error, "string");
    const success = await post();
    assert.equal(success.status, 200);
    assert.match(success.headers.get("content-type")!, /application\/json/);
    assert.deepEqual(await success.json(), { path: realpathSync(directory) });
    assert.deepEqual(app.store.workspaces(), []);
    assert.throws(() => app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: directory } }), { code: "AUTHORIZATION_REQUIRED" });
    implementation = async () => null;
    assert.deepEqual(await (await post()).json(), { path: null });
    implementation = async () => { throw new FolderPickerError("picker unavailable", 503); };
    const failure = await post();
    assert.equal(failure.status, 503); assert.deepEqual(await failure.json(), { error: "picker unavailable" });
    implementation = async () => { throw Error("internal detail"); };
    const unexpected = await post(); assert.equal(unexpected.status, 500);
    assert.deepEqual(await unexpected.json(), { error: "无法打开系统文件夹选择器" });

    implementation = waiting;
    let beginning = new Promise<void>((resolve) => { started = resolve; });
    const disconnected = request(url, { method: "POST", headers: { Origin: app.origin } });
    disconnected.on("error", () => {}); disconnected.end();
    await beginning;
    const busy = await post(); assert.equal(busy.status, 409);
    assert.equal(typeof (await busy.json()).error, "string");
    const aborted = new Promise<void>((resolve) => activeSignal!.addEventListener("abort", () => resolve(), { once: true }));
    disconnected.destroy(); await aborted;
    await new Promise((resolve) => setTimeout(resolve, 10));
    beginning = new Promise<void>((resolve) => { started = resolve; });
    const pending = post(); await beginning;
    const stopping = app.close(); closed = true;
    const stopped = await pending; assert.equal(stopped.status, 503);
    assert.equal(activeSignal!.aborted, true);
    assert.deepEqual(await stopped.json(), { error: "服务正在退出" });
    await stopping;
  } finally {
    if (!closed) await app.close();
    rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  }
});
