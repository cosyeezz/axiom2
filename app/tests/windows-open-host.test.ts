import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WindowsOpenHost } from "../src/server/windows-open-host.js";
import { nativeOpenDialog, OpenDialog, OpenDialogError, type PickPaths } from "../src/server/open-dialog.js";

const windows = { skip: process.platform !== "win32", timeout: 15_000 };
function closed(child: ChildProcess) {
  return new Promise<number | null>((resolve) => child.once("close", resolve));
}

for (const stop of ["shutdown", "cancel", "already-exited"] as const) {
  test(`native ${stop} releases retained output pipes only after the owned process exits`, windows, async () => {
    let holderPid: number | undefined;
    let holderReady!: () => void;
    const holderStarted = new Promise<void>(resolve => { holderReady = resolve; });
    const host = new WindowsOpenHost("dialog", () => {
      const child = spawn(process.execPath, ["-e", String.raw`
        const { spawn } = require('node:child_process');
        const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'],
          { stdio: ['ignore', 1, 2], windowsHide: true, detached: true });
        holder.once('spawn', () => { process.send({ holder: holder.pid }); process.stdout.write('ready\n'); });
        process.stdin.resume(); process.stdin.once('end', () => process.exit(0));
      `], { stdio: ["pipe", "pipe", "pipe", "ipc"], windowsHide: true }) as ChildProcessWithoutNullStreams;
      child.on("message", message => { holderPid = (message as { holder: number }).holder; holderReady(); });
      return child;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const child = await host.take(false);
      await holderStarted;
      const exited = once(child, "exit"), done = closed(child);
      if (stop === "already-exited") { child.stdin!.end(); await exited; }
      const stopping = stop === "cancel" ? (child.kill("SIGKILL"), done) : host.close();
      await exited;
      assert.ok(child.exitCode !== null || child.signalCode !== null);
      await Promise.race([stopping, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(Error("exited native host is waiting for inherited output pipes")), 5000);
      })]);
      process.kill(holderPid!, 0); // The pipe holder is still alive: it did not release EOF for us.
      assert.equal(child.stdout!.destroyed, true);
      assert.equal(child.stderr!.destroyed, true);
    } finally {
      clearTimeout(timer);
      if (holderPid) { try { process.kill(holderPid, "SIGKILL"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; } }
      await host.close();
    }
  });
}

test("normal native completion preserves output arriving after process exit", windows, async () => {
  const directory = mkdtempSync(join(tmpdir(), "axiom-native-tail-")), release = join(directory, "release");
  let writerPid: number | undefined, writerFinished = false;
  let writerReady!: () => void;
  const writerStarted = new Promise<void>(resolve => { writerReady = resolve; });
  const host = new WindowsOpenHost("dialog", () => {
    const child = spawn(process.execPath, ["-e", String.raw`
    const { spawn } = require('node:child_process');
    process.stdout.write('ready\n'); process.stdin.resume();
    process.stdin.once('end', () => {
      const writer = spawn(process.execPath, ['-e',
        'const fs = require("node:fs"); const timer = setInterval(() => { if (fs.existsSync(process.argv[1])) { clearInterval(timer); process.stdout.write(JSON.stringify(["complete"]) + "\\n"); } }, 10); setTimeout(() => process.exit(2), 5000).unref();', process.argv[1]],
        { stdio: ['ignore', 1, 2], windowsHide: true, detached: true });
      writer.once('spawn', () => process.send({ writer: writer.pid }, () => process.exit(0)));
    });
  `, release], { stdio: ["pipe", "pipe", "pipe", "ipc"], windowsHide: true }) as ChildProcessWithoutNullStreams;
    child.on("message", message => { writerPid = (message as { writer: number }).writer; writerReady(); });
    return child;
  });
  try {
    const child = await host.take(false), output: Buffer[] = [];
    child.stdout!.on("data", (chunk: Buffer) => output.push(chunk));
    const exited = once(child, "exit"), done = closed(child);
    child.stdin!.end();
    await exited;
    await writerStarted;
    assert.equal(child.stdout!.destroyed, false, "normal output remains readable after exit");
    writeFileSync(release, "ready"); // The writer cannot produce the result before the real exit.
    const code = await done;
    writerFinished = true;
    assert.equal(code, 0);
    assert.equal(Buffer.concat(output).toString(), '["complete"]\n');
  } finally {
    await host.close();
    if (writerPid && !writerFinished) { try { process.kill(writerPid, "SIGKILL"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; } }
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const mode of ["dialog", "explorer"] as const) {
test(`a prewarmed ${mode} host waits without a request, replaces a failed owner, and cleans active/idle children`, windows, async () => {
  const listeners = process.listenerCount("exit");
  const host = new WindowsOpenHost(mode);
  const command = await host.prepare();
  let first: ChildProcess | undefined, second: ChildProcess | undefined;
  try {
    first = await host.take();
    assert.equal(first.exitCode, null);
    const output: Buffer[] = [];
    first.stdout!.on("data", (chunk: Buffer) => output.push(chunk));
    const firstClosed = closed(first);
    first.stdin!.end("invalid JSON\n"); // Fails before any GUI can be opened.
    assert.equal(await firstClosed, 1);
    assert.equal(Buffer.concat(output).toString(), "", "readiness must not leak into the selection result");
    second = await host.take();
    assert.notEqual(second.pid, first.pid, "a completed/failed request cannot own the next selection");
    assert.equal(second.exitCode, null);
    const secondClosed = closed(second);
    second.stdin!.end(); // Parent pipe closure exits a waiting host without showing a window.
    assert.equal(await secondClosed, 0);
    await host.prepare();
  } finally { await host.close(); }
  assert.ok(first && (first.exitCode !== null || first.signalCode !== null));
  assert.ok(second && (second.exitCode !== null || second.signalCode !== null));
  assert.equal(existsSync(command.file), false);
  assert.equal(process.listenerCount("exit"), listeners);
  await assert.rejects(host.take(), /closed/);
});

test(`service shutdown waits for a claimed prewarmed ${mode} process and does not replenish it`, windows, async () => {
  const listeners = process.listenerCount("exit"), host = new WindowsOpenHost(mode);
  const command = await host.prepare();
  const child = await host.take();
  const exited = closed(child);
  await host.close();
  await exited;
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  assert.equal(existsSync(command.file), false);
  assert.equal(process.listenerCount("exit"), listeners);
  await assert.rejects(host.prepare(), /closed/);
});
}

test("an abort during cold preparation never dispatches a native window and keeps its reason", windows, async () => {
  const listeners = process.listenerCount("exit"), picker = nativeOpenDialog();
  const abort = new AbortController();
  const pending = picker({ kind: "folder", multiple: false }, abort.signal);
  abort.abort(new OpenDialogError("cancelled while preparing", 499));
  try { await assert.rejects(pending, { status: 499, message: "cancelled while preparing" }); }
  finally { await picker.close!(); }
  assert.equal(process.listenerCount("exit"), listeners);
});

for (const mode of ["dialog", "explorer"] as const) {
  test(`${mode}: cancellation interrupts a host stalled before ready and retains ownership until exit`, windows, async () => {
    let launched!: (child: ChildProcess) => void;
    const started = new Promise<ChildProcess>((resolve) => { launched = resolve; });
    const host = new WindowsOpenHost(mode, () => {
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      child.once("spawn", () => launched(child));
      return child;
    });
    const controller = new AbortController();
    const pending = host.take(false, controller.signal);
    const rejected = assert.rejects(pending, { message: "cancel before ready" });
    try {
      const child = await started;
      let exited = false;
      child.once("close", () => { exited = true; });
      const start = performance.now();
      controller.abort(Error("cancel before ready"));
      await rejected;
      assert.equal(exited, true, "request cannot settle while its warming process is still owned");
      assert.ok(performance.now() - start < 1000, "cancellation must not wait for the 15s readiness timeout");
    } finally { await host.close(); }
  });
}

test("shutdown invokes picker cleanup before waiting for an active preparation to settle", { timeout: 2000 }, async () => {
  let entered!: () => void, fail!: (error: Error) => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const picker: PickPaths = async () => new Promise<string[]>((_resolve, reject) => { fail = reject; entered(); });
  picker.close = async () => { fail(new OpenDialogError("closed by picker cleanup", 503)); };
  const dialog = new OpenDialog(picker);
  const pending = dialog.select({ kind: "folder", multiple: false }, new AbortController().signal);
  const rejected = assert.rejects(pending, { status: 503 });
  await started;
  await dialog.close();
  await rejected;
});

test("a ready idle crash is replaced automatically once, and the next request recovers from another crash", windows, async () => {
  const children: ChildProcess[] = [];
  let replacementReady!: () => void;
  const recovered = new Promise<void>((resolve) => { replacementReady = resolve; });
  const host = new WindowsOpenHost("dialog", (file) => {
    const child = spawn(file, ["--standby"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    children.push(child);
    if (children.length === 2) child.stdout.once("data", () => replacementReady());
    return child;
  });
  try {
    await host.prepare();
    const firstClosed = closed(children[0]); children[0].kill("SIGKILL"); await firstClosed;
    await recovered; // No request or explicit prepare call triggers this replacement.
    assert.equal(children.length, 2);
    const secondClosed = closed(children[1]); children[1].kill("SIGKILL"); await secondClosed;
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(children.length, 2, "repeated idle crashes must not cause a restart loop");
    const claimed = await host.take(false);
    assert.equal(children.length, 3);
    const done = closed(claimed); claimed.stdin!.end(); await done;
  } finally { await host.close(); }
});

test("compiler cancellation retains the service slot until close, preserves its reason and removes private files", windows, async (t) => {
  const host = new WindowsOpenHost(), controller = new AbortController();
  const picker: PickPaths = async (_options, signal) => { await host.take(false, signal); throw Error("unexpected native dispatch after compiler cancellation"); };
  picker.close = () => host.close();
  const dialog = new OpenDialog(picker);
  const options = { kind: "folder", multiple: false } as const;
  let compiler: ChildProcess | undefined, exited = false, settled = false, releaseClose: (() => void) | undefined;
  let held!: () => void;
  const closeHeld = new Promise<void>((resolve) => { held = resolve; });
  const observe = (message: unknown) => {
    const child = (message as { process: ChildProcess }).process;
    child.once("spawn", () => {
      if (compiler || !child.spawnfile.toLowerCase().endsWith("csc.exe")) return;
      compiler = child;
      child.once("close", () => { exited = true; });
      // Use a real compiler/termination, but hold delivery of close to expose the service-slot boundary.
      const emit = child.emit;
      t.mock.method(child, "emit", (event: string | symbol, ...args: unknown[]) => {
        if (event !== "close") return Reflect.apply(emit, child, [event, ...args]) as boolean;
        let released = false;
        releaseClose = () => { if (!released) { released = true; Reflect.apply(emit, child, [event, ...args]); } };
        held();
        return true;
      });
      controller.abort();
    });
  };
  subscribe("child_process", observe);
  const started = performance.now();
  const pending = dialog.select(options, controller.signal);
  void pending.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(pending, { status: 499, message: "选择请求已断开" });
  void rejected.catch(() => {});
  try {
    await Promise.race([closeHeld, pending.then(
      () => { throw Error("request settled before the held compiler close"); },
      () => { throw Error("request rejected before the held compiler close"); },
    )]);
    assert.ok(compiler?.pid, "cancellation was triggered after the real compiler spawned");
    assert.ok(compiler.exitCode !== null || compiler.signalCode !== null, "the compiler has exited while close delivery is held");
    assert.equal(exited, false);
    assert.equal(settled, false);
    // A virtual second picker would return immediately if the service incorrectly released its slot.
    await assert.rejects(dialog.select(options, new AbortController().signal, async () => []), { status: 409 });
    assert.equal(settled, false);
    releaseClose!();
    await rejected;
    assert.equal(exited, true, "the service request cannot finish before compiler close");
    assert.equal(existsSync(compiler.spawnargs.at(-1)!), false, "cancelled compilation removes its private source directory");
    assert.ok(performance.now() - started < 1000, "cancellation must not wait for the 30s compiler timeout");
  } finally { unsubscribe("child_process", observe); releaseClose?.(); await dialog.close(); }
});

test("a request between an idle host's exit and close waits for cleanup and shares one live replacement", windows, async () => {
  const children: ChildProcess[] = [];
  const host = new WindowsOpenHost("dialog", (file) => {
    const child = spawn(file, ["--standby"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    children.push(child);
    return child;
  });
  try {
    await host.prepare();
    const old = children[0];
    let exited = false, requestedBeforeClose = false;
    old.once("close", () => { exited = true; });
    const replacement = new Promise<ChildProcess>((resolve, reject) => old.once("exit", () => {
      requestedBeforeClose = !exited;
      void host.take(false).then(resolve, reject);
    }));
    old.kill("SIGKILL");
    const claimed = await replacement;
    assert.equal(requestedBeforeClose, true);
    assert.equal(exited, true);
    assert.equal(children.length, 2, "automatic recovery and the new request share one replacement");
    assert.equal(claimed, children[1]);
    assert.notEqual(claimed.pid, old.pid);
    assert.equal(claimed.exitCode, null);
    const done = closed(claimed); claimed.stdin!.end(); assert.equal(await done, 0);
  } finally { await host.close(); }
});

test("a private executable removed after access but before spawn is rebuilt and retried once", windows, async () => {
  const files: string[] = [], errors: string[] = [];
  const host = new WindowsOpenHost("dialog", (file) => {
    files.push(file);
    if (files.length === 1) rmSync(file); // The host's access check has already completed.
    const child = spawn(file, ["--standby"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    child.on("error", (error: NodeJS.ErrnoException) => { errors.push(error.code ?? "unknown"); });
    return child;
  });
  try {
    const child = await host.take(false);
    assert.deepEqual(errors, ["ENOENT"], "the retry follows an actual failed OS spawn");
    assert.equal(files.length, 2, "one failed spawn is followed by exactly one replacement");
    assert.notEqual(files[1], files[0]);
    assert.equal(existsSync(files[0]), false);
    assert.equal(existsSync(files[1]), true);
    assert.equal(child.exitCode, null);
    const done = closed(child); child.stdin!.end(); assert.equal(await done, 0);
  } finally { await host.close(); }
  for (const file of files) assert.equal(existsSync(file), false);
});

test("an automatic replacement failing before ready stops recovery until the next explicit request", windows, async () => {
  const children: ChildProcess[] = [];
  let replacementStarted!: (child: ChildProcess) => void;
  const started = new Promise<ChildProcess>((resolve) => { replacementStarted = resolve; });
  const host = new WindowsOpenHost("dialog", (file) => {
    const replacing = children.length === 1;
    const child = replacing
      ? spawn(process.execPath, ["-e", "process.stdin.resume(); process.stdin.once('end', () => { process.exitCode = 7; });"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
      : spawn(file, ["--standby"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    children.push(child);
    if (replacing) child.once("spawn", () => replacementStarted(child));
    return child;
  });
  try {
    const command = await host.prepare();
    const firstClosed = closed(children[0]); children[0].kill("SIGKILL"); await firstClosed;
    const replacement = await started;
    const failed = closed(replacement); replacement.stdin!.end(); assert.equal(await failed, 7);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(children.length, 2, "failure before ready must not keep automatically restarting");
    const claimed = await host.take(false);
    assert.equal(children.length, 3, "the next request can start a fresh ready host");
    assert.notEqual(claimed.pid, replacement.pid);
    assert.equal(claimed.exitCode, null);
    assert.equal(existsSync(command.file), true, "a process failure does not unnecessarily rebuild the executable");
    const done = closed(claimed); claimed.stdin!.end(); assert.equal(await done, 0);
  } finally { await host.close(); }
});

test("a missing private executable triggers one shared rebuild and recovers without service restart", windows, async () => {
  const host = new WindowsOpenHost();
  try {
    const original = await host.prepare();
    const child = await host.take(false);
    const done = closed(child); child.stdin!.end(); await done;
    rmSync(original.file);
    const [first, second] = await Promise.all([host.prepare(), host.prepare()]);
    assert.equal(first.file, second.file, "concurrent callers share a replacement build");
    assert.notEqual(first.file, original.file);
    assert.equal(existsSync(first.file), true);
    assert.equal(existsSync(original.file), false);
    const replacement = await host.take(false);
    const finished = closed(replacement); replacement.stdin!.end(); assert.equal(await finished, 0);
  } finally { await host.close(); }
});
