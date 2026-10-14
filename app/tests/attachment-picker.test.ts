import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { windowsOpenSource } from "../src/server/open-dialog-scripts.js";
import { WindowsOpenHost } from "../src/server/windows-open-host.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { randomUUID } from "node:crypto";
import { AttachmentPicker, AttachmentPickerError, attachmentPickerCommand, nativeAttachmentPicker, type PickAttachments } from "../src/server/attachment-picker.js";
import { startServer } from "../src/server/index.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const signal = () => new AbortController().signal;
function fakeProcess() {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null });
  const kills: unknown[] = [];
  child.kill = (s) => {
    kills.push(s);
    queueMicrotask(() => { Object.assign(child, { signalCode: "SIGKILL" }); child.emit("close", null); });
    return true;
  };
  return { child, kills };
}

test("Windows static command supports mixed multiselect and receives directory only through environment", async () => {
  const command = attachmentPickerCommand("win32");
  assert.equal(command.file, "AxiomOpen.exe");
  assert.deepEqual(command.args, []);
  assert.match(windowsOpenSource, /\[STAThread\]/);
  assert.match(windowsOpenSource, /IFileOpenDialog/);
  assert.match(windowsOpenSource, /GetSelectedItems/);
  assert.match(windowsOpenSource, /AXIOM_OPEN_OPTIONS/);
  for (const platform of ["linux", "darwin"] as const) assert.ok(attachmentPickerCommand(platform).file);
  assert.throws(() => attachmentPickerCommand("freebsd"), { status: 503 });
  const paths = ["C:\\中文😀\\图.PNG", "C:\\space & $(bad) ' folder "];
  const { child } = fakeProcess();
  const picker = nativeAttachmentPicker({ platform: "win32", spawn: (_file, args, options) => {
    assert.equal(options.shell, false);
    assert.deepEqual(JSON.parse(options.env!.AXIOM_OPEN_OPTIONS!), { kind: "mixed", multiple: true, title: "打开文件或文件夹", initialDirectory: paths[1] });
    assert.deepEqual(args, command.args);
    queueMicrotask(() => {
      for (const byte of Buffer.from(JSON.stringify(paths))) child.stdout!.emit("data", Buffer.from([byte]));
      child.emit("close", 0);
    });
    return child;
  } });
  assert.deepEqual(await picker(paths[1], signal()), paths);
});

test("native cancellation, invalid output, process errors, size cap and abort", async () => {
  const listeners = process.listenerCount("exit");
  for (const [output, code, status] of [["[]", 0, 0], ["", 0, 500], ["{}", 0, 500], ['[1]', 0, 500], ["[]", 1, 500], [Buffer.from([255]), 0, 500], [Buffer.alloc(1024 * 1024 + 1), 0, 500]] as const) {
    const { child, kills } = fakeProcess();
    const picker = nativeAttachmentPicker({ platform: "win32", spawn: () => {
      queueMicrotask(() => { child.stdout!.emit("data", Buffer.from(output)); if (!kills.length) child.emit("close", code); });
      return child;
    } });
    if (status) await assert.rejects(picker("C:\\", signal()), { status });
    else assert.deepEqual(await picker("C:\\", signal()), []);
  }
  await assert.rejects(nativeAttachmentPicker({ platform: "win32", spawn: () => { throw Error("missing"); } })("C:\\", signal()), { status: 503 });
  const { child, kills } = fakeProcess(), controller = new AbortController();
  const pending = nativeAttachmentPicker({ platform: "win32", spawn: () => child })("C:\\", controller.signal);
  controller.abort(new AttachmentPickerError("abort", 499));
  await assert.rejects(pending, { status: 499 });
  assert.deepEqual(kills, ["SIGKILL"]);
  assert.equal(process.listenerCount("exit"), listeners);
});

test("selection validates absolute existing paths, names and limits; includes empty directories and deduplicates", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-attachments-"));
  const file = join(root, "文字.txt"), image = join(root, "image.PNG"), folder = join(root, "empty folder");
  writeFileSync(file, "hello"); writeFileSync(image, "classification only, no image decoding"); mkdirSync(folder);
  try {
    const picker = new AttachmentPicker(async (directory) => { assert.equal(directory, root); return [file, image, folder, file]; });
    assert.deepEqual(await picker.select(root, signal()), [
      { name: "文字.txt", path: realpathSync(file), kind: "file" },
      { name: "image.PNG", path: realpathSync(image), kind: "image" },
      { name: "empty folder", path: realpathSync(folder), kind: "folder" },
    ]);
    assert.deepEqual(await new AttachmentPicker(async () => []).select(root, signal()), []);
    for (const paths of [["relative"], [join(root, "missing")], [file + "\0"], [file + "\n"], [file + "\x7f"], Array(51).fill(file)]) {
      await assert.rejects(new AttachmentPicker(async () => paths).select(root, signal()), { status: 400 });
    }
    await picker.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("duplicate guard, timeout, disconnect and shutdown settle after owned dialog exits", async () => {
  for (const action of ["timeout", "abort", "close"] as const) {
    const { child, kills } = fakeProcess();
    const picker = new AttachmentPicker(nativeAttachmentPicker({ platform: "win32", spawn: () => child }), action === "timeout" ? 10 : 1000);
    const controller = new AbortController();
    const pending = picker.select("C:\\", controller.signal);
    const rejected = assert.rejects(pending, { status: action === "timeout" ? 504 : action === "abort" ? 499 : 503 });
    await Promise.resolve();
    await assert.rejects(picker.select("C:\\", signal()), { status: 409 });
    const hold = setTimeout(() => {}, 1000);
    try {
      if (action === "abort") controller.abort();
      if (action === "close") await picker.close();
      await rejected;
      assert.deepEqual(kills, ["SIGKILL"]);
      await picker.close();
      await assert.rejects(picker.select("C:\\", signal()), { status: 503 });
    } finally { clearTimeout(hold); }
  }
});

test("actual process abort does not leave the owned process running", { timeout: 5000 }, async () => {
  let child: ChildProcess | undefined;
  const controller = new AbortController();
  const pending = nativeAttachmentPicker({ platform: "win32", spawn: (_file, _args, options) => {
    child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], options); return child;
  } })("C:\\", controller.signal);
  controller.abort(new AttachmentPickerError("abort", 499));
  await assert.rejects(pending, { status: 499 });
  assert.ok(child && (child.exitCode !== null || child.signalCode !== null));
});

test("Windows GUI host prepares once, rejects invalid input without a window and cleans up", { skip: process.platform !== "win32", timeout: 15000 }, async () => {
  const host = new WindowsOpenHost();
  const [command, same] = await Promise.all([host.prepare(), host.prepare()]);
  try {
    assert.deepEqual(command, same);
    assert.ok(existsSync(command.file));
    assert.deepEqual(command.args, []);
    assert.deepEqual(await host.prepare(), command, "opening reuses the prepared binary");
    const result = spawnSync(command.file, command.args, {
      timeout: 5000, windowsHide: true, encoding: "utf8", env: { ...process.env, AXIOM_OPEN_OPTIONS: "invalid" },
    });
    assert.equal(result.status, 1, result.stderr || String(result.error));
    assert.match(result.stderr, /Native Open failed/);
  } finally { await host.close(); }
  assert.equal(existsSync(command.file), false);
  await assert.rejects(host.prepare(), /closed/);
  const cancelled = new WindowsOpenHost();
  const preparing = assert.rejects(cancelled.prepare());
  await cancelled.close();
  await preparing;
});

test("HTTP picker protects origin, method, scope and authorization, revalidates async results and handles lifecycle", { timeout: 30000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-attachments-http-")), pi = join(root, "pi"), directory = join(root, "project");
  mkdirSync(pi); mkdirSync(directory);
  const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = pi;
  let calls = 0, started: (() => void) | undefined, activeSignal: AbortSignal | undefined;
  let implementation: PickAttachments = async () => [directory];
  const app = await startServer({ root, port: 0, pickAttachments: (path, s) => { calls++; activeSignal = s; started?.(); return implementation(path, s); } });
  let closed = false;
  const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: directory, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const other = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: pi, authorized: true } }) as Workspace;
  const base = app.origin + "/api/attachments/pick";
  const url = `${base}?workspaceId=${workspace.id}&sessionId=${session.id}`;
  const post = (target = url) => fetch(target, { method: "POST", headers: { Origin: app.origin } });
  try {
    for (const headers of [{}, { Origin: "null" }, { Origin: "https://evil.example" }, { Origin: app.origin, Host: "evil.example" }, { Origin: app.origin, "Sec-Fetch-Site": "cross-site" }]) {
      await new Promise<void>((resolve, reject) => {
        const req = request(url, { method: "POST", headers }, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => { try { assert.equal(res.statusCode, 403); assert.equal(typeof JSON.parse(Buffer.concat(chunks).toString()).error, "string"); resolve(); } catch (e) { reject(e); } });
        });
        req.on("error", reject); req.end();
      });
    }
    const wrongMethod = await fetch(url, { headers: { Origin: app.origin } });
    assert.equal(wrongMethod.status, 405); assert.equal(wrongMethod.headers.get("allow"), "POST");
    assert.equal((await post(base)).status, 400);
    assert.equal((await post(`${base}?workspaceId=${workspace.id}&sessionId=missing`)).status, 400);
    app.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(workspace.id);
    assert.equal((await post()).status, 403);
    app.store.db.prepare("UPDATE workspaces SET authorized=1 WHERE id=?").run(workspace.id);
    assert.equal(calls, 0);
    implementation = async (path) => { assert.equal(path, workspace.path); return [directory]; };
    assert.deepEqual(await (await post()).json(), { items: [{ name: "project", path: realpathSync(directory), kind: "folder" }] });
    for (const query of ["kind=unknown", "multiple=invalid"]) {
      const before: number = calls;
      assert.equal((await post(`${url}&${query}`)).status, 400);
      assert.equal(calls, before, "invalid mode must not open a native window");
    }
    assert.equal((await post(`${url}&kind=file&multiple=false`)).status, 400, "file mode rejects a returned directory");
    assert.equal((await post(`${url}&kind=folder&multiple=false`)).status, 200);
    implementation = async () => [directory, pi];
    assert.equal((await post(`${url}&kind=folder&multiple=false`)).status, 400, "single mode rejects multiple paths");
    assert.equal((await post(`${url}&kind=folder&multiple=true`)).status, 200);
    implementation = async () => [];
    assert.deepEqual(await (await post()).json(), { items: [] });
    implementation = async () => { throw Error("internal detail"); };
    const failed = await post(); assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: "无法打开系统附件选择器" });
    for (const mutation of ["revoke", "archive", "change-scope"] as const) {
      let finish!: (paths: string[]) => void;
      implementation = () => new Promise((resolve) => { finish = resolve; });
      const beginning = new Promise<void>((resolve) => { started = resolve; });
      const pending = post(); await beginning;
      if (mutation === "revoke") app.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(workspace.id);
      if (mutation === "archive") app.store.db.prepare("UPDATE workspaces SET archived=1 WHERE id=?").run(workspace.id);
      if (mutation === "change-scope") app.store.db.prepare("UPDATE sessions SET workspaceId=? WHERE id=?").run(other.id, session.id);
      finish([directory]);
      const result = await pending;
      assert.notEqual(result.status, 200, mutation);
      assert.equal(typeof (await result.json()).error, "string");
      app.store.db.prepare("UPDATE workspaces SET authorized=1,archived=0 WHERE id=?").run(workspace.id);
      app.store.db.prepare("UPDATE sessions SET workspaceId=? WHERE id=?").run(workspace.id, session.id);
    }
    implementation = (_path, s) => new Promise((_resolve, reject) => s.addEventListener("abort", () => reject(s.reason), { once: true }));
    let beginning = new Promise<void>((resolve) => { started = resolve; });
    const disconnected = request(url, { method: "POST", headers: { Origin: app.origin } });
    disconnected.on("error", () => {}); disconnected.end(); await beginning;
    assert.equal((await post()).status, 409);
    const aborted = new Promise<void>((resolve) => activeSignal!.addEventListener("abort", () => resolve(), { once: true }));
    disconnected.destroy(); await aborted;
    await new Promise((resolve) => setTimeout(resolve, 10));
    beginning = new Promise<void>((resolve) => { started = resolve; });
    const pending = post(); await beginning;
    const stopping = app.close(); closed = true;
    assert.equal((await pending).status, 503); assert.equal(activeSignal!.aborted, true);
    await stopping;
  } finally {
    if (!closed) await app.close();
    rmSync(root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  }
});
