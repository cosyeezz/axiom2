import assert from "node:assert/strict";
import { test } from "node:test";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { Terminal, TerminalError, nativeTerminal, terminalLaunchers, type OpenTerminal } from "../src/server/terminal.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-terminal-"));
  const directory = join(root, process.platform === "win32" ? "项目 空格 # % & ' ; $(touch injected) +" : "项目 空格 # % & ' \" ; $(touch injected) +");
  mkdirSync(directory);
  return { root, directory, remove: () => rmSync(root, { recursive: true, force: true }) };
}

test("terminal validates the exact directory before launching; files and missing directories are not opened", async () => {
  const f = fixture(), calls: string[] = [];
  const terminal = new Terminal(async directory => { calls.push(directory); });
  try {
    const signal = new AbortController().signal;
    const file = join(f.root, "file.txt"); writeFileSync(file, "not a directory");
    for (const invalid of ["relative", "https://example.com", file, join(f.root, "missing"), f.directory + "\n", f.directory + "\0", "/" + "a".repeat(4096)])
      await assert.rejects(terminal.open(invalid, signal), { status: 400 });
    assert.deepEqual(calls, []);
    await terminal.open(f.directory, signal);
    assert.deepEqual(calls, [f.directory]);
    await assert.rejects(terminal.open(f.directory, AbortSignal.abort()));
    assert.equal(calls.length, 1);
  } finally { await terminal.close(); f.remove(); }
});

test("native launchers pass paths as data and do not wait for terminal window closure", () => {
  const directory = "/项目/a ' \" & ; $() % path";
  assert.deepEqual(terminalLaunchers(directory, "darwin"), [{ file: "/usr/bin/open", args: ["-a", "Terminal", directory] }]);
  const [windows] = terminalLaunchers(directory, "win32");
  assert.match(windows.file, /System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/);
  const script = Buffer.from(windows.args.at(-1)!, "base64").toString("utf16le");
  assert.equal(script, "$ErrorActionPreference = 'Stop'; Start-Process -FilePath $env:ComSpec -WorkingDirectory $env:AXIOM_TERMINAL_CWD");
  assert.equal(script.includes(directory), false);
  assert.equal(windows.env?.AXIOM_TERMINAL_CWD, directory);
  assert.match(windows.env?.ComSpec ?? "", /System32\\cmd\.exe$/);
  assert.equal(windows.args.includes("-Wait"), false);
  const linux = terminalLaunchers(directory, "linux");
  assert.equal(linux[0].file, "/usr/bin/x-terminal-emulator");
  assert.ok(linux.every(launcher => launcher.persistent && launcher.file.startsWith("/usr/bin/")));
  assert.deepEqual(linux.find(launcher => launcher.file.endsWith("gnome-terminal"))?.args, ["--working-directory", directory]);
  assert.throws(() => terminalLaunchers(directory, "freebsd"), TerminalError);
});

for (const platform of ["darwin", "win32"] as const) {
  test(`${platform} launcher uses shell:false, exact cwd, and reports nonzero exit or cancellation`, async t => {
    const f = fixture(), originalSpawn = childProcess.spawn;
    const calls: { file: string; args: string[]; options: any }[] = [];
    let mode = "success";
    t.mock.method(childProcess, "spawn", (file: string, args: string[], options: any) => {
      calls.push({ file, args, options });
      return originalSpawn(process.execPath, ["-e", mode === "hold" ? "setTimeout(() => {}, 30000)" : `process.exitCode = ${mode === "failure" ? 1 : 0}`], options);
    });
    syncBuiltinESMExports();
    const terminal = new Terminal(nativeTerminal(platform));
    try {
      const signal = new AbortController().signal;
      await terminal.open(f.directory, signal);
      assert.equal(calls[0].options.cwd, f.directory);
      assert.equal(calls[0].options.shell, false);
      assert.equal(calls[0].options.stdio, "ignore");
      mode = "failure";
      await assert.rejects(terminal.open(f.directory, signal), { status: 503 });
      mode = "hold";
      const request = new AbortController();
      const pending = terminal.open(f.directory, request.signal);
      const rejected = assert.rejects(pending, { status: 499 });
      // Directory validation is asynchronous; wait until the helper is actually owned.
      while (calls.length < 3) await new Promise(resolve => setTimeout(resolve, 5));
      request.abort(); await rejected;
      mode = "success"; await terminal.open(f.directory, signal);
    } finally { await terminal.close(); t.mock.restoreAll(); syncBuiltinESMExports(); f.remove(); }
  });
}

test("Linux skips missing launchers, accepts persistent startup, and never falls back after a desktop failure", async t => {
  const f = fixture(), originalSpawn = childProcess.spawn;
  const calls: string[] = [], children: ReturnType<typeof originalSpawn>[] = [];
  let failure = false, allMissing = false;
  t.mock.method(childProcess, "spawn", (file: string, _args: string[], options: any) => {
    calls.push(file);
    const child = allMissing || file.endsWith("x-terminal-emulator")
      ? originalSpawn(join(f.root, "does-not-exist"), [], options)
      : originalSpawn(process.execPath, ["-e", failure ? "process.exitCode = 1" : "setTimeout(() => {}, 30000)"], options);
    children.push(child); return child;
  });
  syncBuiltinESMExports();
  const terminal = new Terminal(nativeTerminal("linux"));
  try {
    const signal = new AbortController().signal;
    await terminal.open(f.directory, signal);
    assert.deepEqual(calls, ["/usr/bin/x-terminal-emulator", "/usr/bin/gnome-terminal"]);
    assert.equal(children[1].exitCode, null, "receipt does not wait for the terminal to close");
    await terminal.close();
    assert.equal(children[1].exitCode, null, "service shutdown leaves accepted user terminals alone");
    failure = true; calls.length = 0;
    await assert.rejects(new Terminal(nativeTerminal("linux")).open(f.directory, signal), { status: 503 });
    assert.deepEqual(calls, ["/usr/bin/x-terminal-emulator", "/usr/bin/gnome-terminal"]);
    allMissing = true; calls.length = 0;
    await assert.rejects(nativeTerminal("linux")(f.directory, signal), TerminalError);
    assert.equal(calls.length, 5);
  } finally {
    for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
    await terminal.close(); t.mock.restoreAll(); syncBuiltinESMExports(); f.remove();
  }
});

test("terminal blocks duplicate requests until cancellation settles, then permits retry", async () => {
  const f = fixture();
  let entered!: () => void, release!: () => void, observed: AbortSignal | undefined;
  let ready = new Promise<void>(resolve => { entered = resolve; });
  const terminal = new Terminal(async (_directory, signal) => {
    observed = signal; entered();
    await new Promise<void>(resolve => { release = resolve; });
    signal.throwIfAborted();
  });
  try {
    const request = new AbortController();
    const pending = terminal.open(f.directory, request.signal);
    const rejected = assert.rejects(pending, { status: 499 });
    await ready; request.abort();
    assert.ok(observed?.aborted);
    await assert.rejects(terminal.open(f.directory, new AbortController().signal), { status: 409 });
    release(); await rejected;
    ready = new Promise<void>(resolve => { entered = resolve; });
    const retry = terminal.open(f.directory, new AbortController().signal);
    await ready; release(); await retry;
  } finally { release?.(); await terminal.close(); f.remove(); }
});

test("terminal timeout and shutdown abort pending launches and reject later requests", async () => {
  const f = fixture();
  let aborted = 0, entered = () => {};
  const open: OpenTerminal = async (_directory, signal) => {
    entered();
    await new Promise<void>((_resolve, reject) => {
      const alive = setTimeout(() => reject(Error("helper was not cancelled")), 2000);
      signal.addEventListener("abort", () => { aborted++; clearTimeout(alive); setImmediate(() => reject(signal.reason)); }, { once: true });
    });
  };
  const timed = new Terminal(open, 50), stopping = new Terminal(open);
  try {
    await assert.rejects(timed.open(f.directory, new AbortController().signal), { status: 504 });
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const pending = stopping.open(f.directory, new AbortController().signal);
    const rejected = assert.rejects(pending, { status: 503, message: "服务正在退出" });
    await ready; await stopping.close(); await rejected;
    assert.equal(aborted, 2);
    await assert.rejects(stopping.open(f.directory, new AbortController().signal), { status: 503 });
  } finally { await timed.close(); await stopping.close(); f.remove(); }
});
