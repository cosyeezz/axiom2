import assert from "node:assert/strict";
import { test } from "node:test";
import childProcess, { spawn } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileManager, FileManagerError, nativeFileManager, type RevealDirectory } from "../src/server/file-manager.js";
import { WindowsOpenHost } from "../src/server/windows-open-host.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-file-manager-"));
  const directory = join(root, "项目 空格 # % & ' +");
  mkdirSync(directory);
  return { root, directory, remove: () => rmSync(root, { recursive: true, force: true }) };
}

test("file manager validates the directory before dispatch and preserves exact Unicode/URI characters", async () => {
  const f = fixture(), calls: string[] = [];
  const manager = new FileManager(async (directory) => { calls.push(directory); });
  try {
    const signal = new AbortController().signal;
    const file = join(f.root, "file.txt"); writeFileSync(file, "test");
    for (const invalid of ["relative", file, join(f.root, "missing"), f.directory + "\n"])
      await assert.rejects(manager.open(invalid, signal), { status: 400 });
    assert.deepEqual(calls, []);
    await manager.open(f.directory, signal);
    assert.deepEqual(calls, [f.directory]);
  } finally { await manager.close(); f.remove(); }
});

test("file selection preserves the filename and rejects missing or unrelated targets before opening", async () => {
  const f = fixture(), calls: { directory: string; selection?: string }[] = [];
  const manager = new FileManager(async (directory, _signal, selection) => { calls.push({ directory, selection }); });
  try {
    const signal = new AbortController().signal, file = join(f.directory, "文档 # % & ' +.txt");
    writeFileSync(file, "select me");
    for (const selection of ["relative.txt", join(f.directory, "missing"), f.directory, join(f.root, "outside.txt"), file + "\n"])
      await assert.rejects(manager.open(f.directory, signal, selection), { status: 400 });
    assert.deepEqual(calls, []);
    await manager.open(f.directory, signal, file);
    assert.deepEqual(calls, [{ directory: f.directory, selection: file }]);
  } finally { await manager.close(); f.remove(); }
});

for (const platform of ["darwin", "linux"] as const) {
  test(`${platform} reveals files without launching their handler and reports opener failure`, async t => {
    const f = fixture(), descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
    const originalSpawn = childProcess.spawn, calls: { executable: string; args: string[]; options: any }[] = [];
    let exitCode = 0;
    Object.defineProperty(process, "platform", { ...descriptor, value: platform });
    t.mock.method(childProcess, "spawn", (executable: string, args: string[], options: any) => {
      calls.push({ executable, args, options });
      return originalSpawn(process.execPath, ["-e", `process.exitCode = ${exitCode}`], options);
    });
    syncBuiltinESMExports();
    const manager = new FileManager();
    try {
      const signal = new AbortController().signal, file = join(f.directory, "文档, # % & ' +.txt");
      writeFileSync(file, "never execute me");
      await manager.open(f.directory, signal, file);
      assert.equal(calls[0].options.shell, false);
      if (platform === "darwin") {
        assert.equal(calls[0].executable, "/usr/bin/open");
        assert.deepEqual(calls[0].args, ["-R", file]);
      } else {
        assert.equal(calls[0].executable, "dbus-send");
        assert.ok(calls[0].args.includes("org.freedesktop.FileManager1.ShowItems"));
        assert.ok(calls[0].args.includes(`array:string:${pathToFileURL(file).href.replace(/,/g, "%2C")}`));
      }
      await manager.open(f.directory, signal);
      assert.deepEqual(calls[1].args, [f.directory]);
      assert.equal(calls[1].executable, platform === "darwin" ? "/usr/bin/open" : "xdg-open");
      exitCode = 1;
      await assert.rejects(manager.open(f.directory, signal, file), { status: 503 });
      exitCode = 0;
      await manager.open(f.directory, signal, file);
    } finally {
      await manager.close(); t.mock.restoreAll(); syncBuiltinESMExports();
      Object.defineProperty(process, "platform", descriptor); f.remove();
    }
  });
}

test("disconnect retains the active slot until the owned helper settles, then allows retry", async () => {
  const f = fixture();
  let entered!: () => void, release!: () => void, observed: AbortSignal | undefined;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const manager = new FileManager(async (_directory, signal) => {
    observed = signal; entered();
    await new Promise<void>((resolve) => { release = resolve; });
    signal.throwIfAborted();
  });
  const request = new AbortController();
  try {
    const operation = manager.open(f.directory, request.signal);
    const rejected = assert.rejects(operation, { status: 499 });
    await ready;
    request.abort();
    assert.equal(observed?.aborted, true);
    await assert.rejects(manager.open(f.directory, new AbortController().signal), { status: 409 });
    release(); await rejected;
    const retryReady = new Promise<void>((resolve) => { entered = resolve; });
    const retry = manager.open(f.directory, new AbortController().signal);
    await retryReady;
    release(); await retry;
  } finally { release?.(); await manager.close(); f.remove(); }
});

test("timeout and shutdown abort the helper, wait for exit, and reject later requests", async () => {
  const f = fixture();
  let aborted = 0, closed = 0, entered = () => {};
  const reveal: RevealDirectory = async (_directory, signal) => {
    signal.throwIfAborted();
    entered();
    await new Promise<void>((_resolve, reject) => {
      const alive = setTimeout(() => reject(Error("test helper was not cancelled")), 2000);
      signal.addEventListener("abort", () => {
        aborted++; clearTimeout(alive);
        setImmediate(() => reject(signal.reason)); // The process may exit after its abort signal.
      }, { once: true });
    });
  };
  reveal.close = async () => { closed++; };
  const timed = new FileManager(reveal, 50), stopping = new FileManager(reveal);
  try {
    await assert.rejects(timed.open(f.directory, new AbortController().signal), { status: 504 });
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const pending = stopping.open(f.directory, new AbortController().signal);
    const rejected = assert.rejects(pending, { status: 503 });
    await ready;
    await stopping.close();
    await rejected;
    assert.equal(aborted, 2);
    assert.equal(closed, 1);
    await assert.rejects(stopping.open(f.directory, new AbortController().signal), { status: 503 });
  } finally { await timed.close(); await stopping.close(); f.remove(); }
});

test("Windows foreground failure is explicit, waits for helper close, and permits retry without accepting malformed success", {
  skip: process.platform !== "win32", timeout: 15_000,
}, async (t) => {
  const f = fixture();
  let response = { code: 2, output: "foreground-unavailable" }, closed = false;
  t.mock.method(WindowsOpenHost.prototype, "take", async () => {
    closed = false;
    const child = spawn(process.execPath, ["-e", `process.stdin.resume(); process.stdin.once('end', () => {
      process.stdout.write(${JSON.stringify(response.output)} + '\\n'); process.exitCode = ${response.code};
    });`], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.on("error", () => {});
    child.once("close", () => { closed = true; });
    return child;
  });
  const manager = new FileManager();
  try {
    await assert.rejects(manager.open(f.directory, new AbortController().signal), {
      status: 503, message: "无法将系统文件管理器切换到前台，请确认 Windows 桌面已连接并解锁后重试",
    });
    assert.equal(closed, true, "failure is delivered only after the owned helper's pipes close");
    response = { code: 0, output: "foreground-unavailable" };
    await assert.rejects(manager.open(f.directory, new AbortController().signal), { status: 503, message: "无法打开系统文件管理器" });
    assert.equal(closed, true);
    response = { code: 0, output: "opened" };
    await manager.open(f.directory, new AbortController().signal);
    assert.equal(closed, true);
  } finally { await manager.close(); f.remove(); }
});

test("Windows abort during native Explorer preparation keeps its reason and never dispatches a window", {
  skip: process.platform !== "win32", timeout: 15_000,
}, async () => {
  const f = fixture(), listeners = process.listenerCount("exit"), reveal = nativeFileManager();
  const request = new AbortController();
  const pending = reveal(f.directory, request.signal);
  request.abort(new FileManagerError("cancelled before dispatch", 499));
  try { await assert.rejects(pending, { status: 499, message: "cancelled before dispatch" }); }
  finally { await reveal.close!(); f.remove(); }
  assert.equal(process.listenerCount("exit"), listeners);
});
