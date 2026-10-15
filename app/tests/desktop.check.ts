// Exercise the real Pake WebView2 + Rust bridge against an isolated service.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, copyFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser } from "playwright";
import { DatabaseSync } from "node:sqlite";
import { inspectDesktopWindow } from "./desktop-window.js";
if (process.platform !== "win32") throw Error("This native check requires Windows WebView2.");
const root = await mkdtemp(join(tmpdir(), "axiom-desktop-service-"));
const freePort = async () => {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
};
const port = await freePort();
const debugPort = await freePort();
const data = join(root, "data");
const pi = join(root, "pi");
await mkdir(data); await mkdir(pi);
const cli = resolve("../bin/axiom2.mjs");
await writeFile(join(data, "installation.json"), JSON.stringify({ node: process.execPath, cli }));
const env = { ...process.env, AXIOM_DATA_DIR: data, AXIOM_PI_DIR: pi, PI_CODING_AGENT_DIR: pi, AXIOM_PORT: String(port),
  WEBVIEW2_USER_DATA_FOLDER: join(root, "webview"), AXIOM_DESKTOP_DEBUG_PORT: String(debugPort),
  AXIOM_DESKTOP_PROBE_REPORT: join(root, "probe.json"), AXIOM_DESKTOP_PROBE_MODE: "inspect" };
const control = async (action: string) => JSON.parse((await promisify(execFile)(process.execPath, [cli, action, "--json"], { env, timeout: 50_000 })).stdout);
const binary = resolve(process.env.AXIOM_DESKTOP_BINARY || "Axiom2-ServiceTest.exe");
let native = spawn(binary, [], { env, stdio: "ignore" });
// WM_CLOSE follows the same native close-request path as the title-bar button.
// Match both the owned process and exact title; never touch another client.
const closeWindow = async (title: string) => {
  assert.ok(native.pid);
  const script = `Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class DesktopClose {
  delegate bool Callback(IntPtr handle, IntPtr state);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr state);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr handle, out uint process);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr handle, uint message, IntPtr w, IntPtr l);
  public static int Close(uint process, string title) {
    int count = 0;
    EnumWindows((handle, state) => {
      uint owner; GetWindowThreadProcessId(handle, out owner);
      var text = new StringBuilder(512); GetWindowText(handle, text, text.Capacity);
      if (owner == process && text.ToString() == title && PostMessage(handle, 0x0010, IntPtr.Zero, IntPtr.Zero)) count++;
      return true;
    }, IntPtr.Zero);
    return count;
  }
}
'@
[DesktopClose]::Close(${native.pid}, '${title.replaceAll("'", "''")}')`;
  const result = await promisify(execFile)("powershell.exe", ["-NoProfile", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { timeout: 15_000 });
  assert.equal(result.stdout.trim(), "1", `Expected one owned window titled ${title}`);
};
const connectDesktop = async () => {
  for (let i = 0; i < 100; i++) {
    if (native.exitCode !== null) throw Error(`Desktop exited: ${native.exitCode}`);
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 1000 }); } catch { await delay(200); }
  }
  throw Error("WebView2 remote debugging endpoint did not become available");
};
let browser: Browser | undefined;
let completed = false;
const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; } };
try {
  browser = await connectDesktop();
  let context = browser.contexts()[0];
  context.setDefaultTimeout(15_000);
  let page = context.pages().find((page) => page.url().includes("tauri.localhost"));
  if (!page) { await delay(1000); page = context.pages().find((page) => page.url().includes("tauri.localhost")); }
  assert.ok(page, "The packaged controller must load locally without a service");
  page.on("pageerror", (error) => console.error("WebView page error:", error.message));
  page.on("console", (message) => { if (message.type() === "error") console.error("WebView console:", message.text()); });
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/desktop-service-initial.png" });
  try { await page.getByRole("heading", { name: "服务已停止", exact: true }).waitFor({ timeout: 15_000 }); }
  catch (error) { console.error("Controller URL:", page.url(), "Content:", await page.locator("body").innerText()); throw error; }
  await page.screenshot({ path: "test-results/desktop-service-stopped.png" });
  await inspectDesktopWindow(native.pid!, { width: 430, height: 900 });
  await page.waitForFunction(() => innerWidth < 500);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "Controller must fit narrow windows");
  await page.screenshot({ path: "test-results/desktop-service-mobile.png" });
  await inspectDesktopWindow(native.pid!, { width: 1456, height: 939 });
  await page.waitForFunction(() => innerWidth > 1000);
  // Hold a real detached daemon inside initialization, then stop it through Rust/UI.
  const fixture = join(root, "fixture");
  await mkdir(fixture);
  await copyFile(resolve("../bin/service.mjs"), join(fixture, "service.mjs"));
  const fixtureCli = join(fixture, "axiom2.mjs");
  await copyFile(resolve("tests/fixtures/service-startup-cli.mjs"), fixtureCli);
  await writeFile(join(data, "bootstrap-gate"), "");
  const fixtureCommand = (action: string) => promisify(execFile)(process.execPath, [fixtureCli, action], {
    env: { ...env, TEST_CONTROL_TIMEOUT: "1000" }, timeout: 15000,
  });
  const timedOutStart = fixtureCommand("start").then(() => { throw Error("Blocked initialization unexpectedly completed"); }, (error) => JSON.parse(error.stdout));
  for (let i = 0; ; i++) {
    try { await stat(join(data, "initializing")); break; } catch { if (i >= 100) throw Error("Fixture did not initialize"); await delay(100); }
  }
  assert.match((await timedOutStart).message, /仍在启动/);
  await page.getByRole("heading", { name: "服务正在启动", exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭后台服务", exact: true }).click();
  await page.getByRole("button", { name: "确认关闭服务", exact: true }).click();
  for (let i = 0; ; i++) {
    if (JSON.parse((await fixtureCommand("status")).stdout).state === "stopping") break;
    if (i >= 50) throw Error("Desktop did not stop the initializing service");
    await delay(100);
  }
  await writeFile(join(data, "initialize-gate"), "");
  await page.getByRole("heading", { name: "服务已停止", exact: true }).waitFor();
  assert.equal(JSON.parse((await fixtureCommand("status")).stdout).state, "stopped");
  await writeFile(join(data, "installation.json"), JSON.stringify({ node: process.execPath, cli }));
  await page.getByRole("button", { name: "启动后台服务" }).click();
  await page.getByRole("heading", { name: "服务运行中", exact: true }).waitFor({ timeout: 50_000 });
  assert.equal((await control("status")).background, true);
  const workspace = join(root, "workspace"); await mkdir(workspace);
  const db = new DatabaseSync(join(data, "axiom.sqlite"));
  try {
    db.prepare("INSERT INTO workspaces(id,path,pathKey,name,authorized) VALUES(?,?,?,?,1)").run("switch-workspace", workspace, workspace.toLowerCase(), "切换保留项目");
    db.prepare("INSERT INTO sessions(id,workspaceId,title,updatedAt) VALUES(?,?,?,?)").run("switch-session", "switch-workspace", "切换保留会话", Date.now());
  } finally { db.close(); }
  await page.getByRole("button", { name: "打开工作台" }).click();
  for (let i = 0; i < 30 && context.pages().length < 2; i++) await delay(200);
  let workbench = context.pages().find((candidate) => candidate.url().startsWith(`http://127.0.0.1:${port}`));
  assert.ok(workbench, "Ready service opens a child workbench WebView");
  await inspectDesktopWindow(native.pid!);
  await workbench.getByRole("link", { name: "打开应用配置", exact: true }).waitFor();
  await workbench.getByRole("link", { name: "打开应用配置", exact: true }).click();
  await workbench.getByRole("heading", { name: "模型服务", exact: true }).waitFor();
  const denied = await workbench.evaluate(async () => {
    const bridge = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (name: string, args: object) => Promise<unknown> } }).__TAURI_INTERNALS__;
    if (!bridge) throw Error("IPC bridge unavailable: cannot exercise caller authorization");
    const commands = [["axiom_service", { action: "stop" }], ["axiom_update", { action: "status" }], ["axiom_controls", {}]] as const;
    return Promise.all(commands.map(async ([name, args]) => {
      try { await bridge.invoke(name, args); return false; }
      catch (error) { return /内置页面|not allowed|not permitted|denied/i.test(String(error)); }
    }));
  });
  assert.deepEqual(denied, [true, true, true], "Remote child must not inherit the parent window's management permissions");
  assert.equal((await control("status")).state, "running");
  await workbench.goto(`http://127.0.0.1:${port}/`);
  await workbench.getByRole("button", { name: /^切换保留会话/ }).click();
  const draft = workbench.getByRole("textbox", { name: "描述你的编码任务" });
  await draft.fill("切换视图后保留这份尚未发送的草稿。");
  await draft.evaluate((input: HTMLTextAreaElement) => { input.focus(); input.setSelectionRange(3, 8); });
  // The scroll fixture lives in the real thread; its sentinel also detects a reload.
  await workbench.evaluate(() => {
    (window as any).__switchSentinel = crypto.randomUUID();
    const content = document.createElement("div"); content.id = "switch-scroll-fixture"; content.style.height = "2400px";
    document.getElementById("messages")!.append(content);
  });
  await delay(200);
  await workbench.locator("#thread").evaluate((thread) => { thread.scrollTop = 237; });
  const beforeSwitch = await workbench.evaluate(() => ({ sentinel: (window as any).__switchSentinel, scroll: document.getElementById("thread")!.scrollTop }));
  assert.ok(beforeSwitch.scroll > 0);
  await page.getByRole("button", { name: "服务与更新" }).click();
  await page.getByRole("heading", { name: "服务运行中", exact: true }).waitFor();
  assert.ok(!workbench.isClosed(), "Returning to controls must keep the workbench instance");
  await inspectDesktopWindow(native.pid!);
  await page.getByRole("button", { name: "打开工作台" }).click();
  await page.getByRole("navigation", { name: "桌面导航" }).waitFor();
  assert.equal(context.pages().find((candidate) => candidate.url().startsWith(`http://127.0.0.1:${port}`)), workbench);
  assert.equal(await draft.inputValue(), "切换视图后保留这份尚未发送的草稿。");
  assert.deepEqual(await workbench.evaluate(() => ({ sentinel: (window as any).__switchSentinel, scroll: document.getElementById("thread")!.scrollTop })), beforeSwitch);
  await workbench.waitForFunction(() => document.hasFocus() && document.activeElement?.tagName === "TEXTAREA");
  assert.deepEqual(await draft.evaluate((input: HTMLTextAreaElement) => [input.selectionStart, input.selectionEnd]), [3, 8]);
  const second = spawn(binary, [], { env, stdio: "ignore" });
  const secondExit = new Promise<number | null>((done, reject) => { second.once("error", reject); second.once("exit", done); });
  try {
    assert.equal(await Promise.race([secondExit, delay(10000, undefined, { ref: false }).then(() => { throw Error("Second instance did not hand off to the existing window"); })]), 0);
  } finally { if (second.exitCode === null && second.signalCode === null) second.kill(); }
  await workbench.waitForFunction(() => document.hasFocus() && document.activeElement?.tagName === "TEXTAREA");
  await inspectDesktopWindow(native.pid!);
  for (const size of [{ width: 1100, height: 900 }, { width: 1440, height: 1000 }]) {
    const nativeBounds = await inspectDesktopWindow(native.pid!, size);
    await delay(200);
    const barBounds = await page.evaluate(() => ({ width: innerWidth * devicePixelRatio, height: innerHeight * devicePixelRatio, scale: devicePixelRatio }));
    const workbenchBounds = await workbench.evaluate(() => ({ width: innerWidth * devicePixelRatio, height: innerHeight * devicePixelRatio, scale: devicePixelRatio }));
    const nativeViews: { windows: string[]; views: { label: string; x: number; y: number; width: number; height: number }[] } = await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke("axiom_test_probe", { action: "snapshot" }));
    const bar = nativeViews.views.find((view) => view.label === "pake");
    const content = nativeViews.views.find((view) => view.label === "axiom-workbench");
    assert.ok(bar && content);
    assert.deepEqual(nativeViews.windows, ["pake"]);
    assert.equal(nativeViews.views.length, 2);
    assert.equal(bar.width, nativeBounds.clientWidth);
    assert.equal(content.width, nativeBounds.clientWidth);
    assert.equal(bar.x, 0); assert.equal(bar.y, 0); assert.equal(content.x, 0);
    assert.equal(content.y, bar.height);
    assert.equal(bar.height + content.height, nativeBounds.clientHeight, "Native child rectangles must cover the resized content area without overlap or gaps");
    console.log("Native/view bounds:", JSON.stringify({ nativeBounds, nativeViews, barBounds, workbenchBounds }));
    // WebView2 rounds CSS viewport dimensions at fractional OS text/zoom scales.
    assert.ok(Math.abs(barBounds.width - bar.width) <= 2 * barBounds.scale);
    assert.ok(Math.abs(workbenchBounds.width - content.width) <= 2 * workbenchBounds.scale);
    assert.ok(Math.abs(barBounds.height - bar.height) <= 2 * barBounds.scale);
    assert.ok(Math.abs(workbenchBounds.height - content.height) <= 2 * workbenchBounds.scale);
  }
  await page.screenshot({ path: "test-results/desktop-single-window-bar.png" });
  await workbench.screenshot({ path: "test-results/desktop-single-window-workbench.png" });
  await page.getByRole("button", { name: "服务与更新" }).click();
  await page.waitForFunction(() => innerHeight > 100);
  const restoredBounds = await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke("axiom_test_probe", { action: "snapshot" }));
  assert.equal(restoredBounds.current, "control");
  assert.equal(restoredBounds.views.find((view: { label: string }) => view.label === "pake")?.height, restoredBounds.height, "Returning must restore full-height controls");
  await page.screenshot({ path: "test-results/desktop-service-running.png" });
  await page.getByRole("button", { name: "关闭后台服务" }).click();
  await page.getByRole("button", { name: "继续运行" }).click();
  assert.equal((await control("status")).state, "running", "Cancelling must preserve service");
  await page.getByRole("button", { name: "关闭后台服务" }).click();
  await page.getByRole("button", { name: "确认关闭服务" }).click();
  await page.getByRole("heading", { name: "服务已停止", exact: true }).waitFor({ timeout: 50_000 });
  assert.equal((await control("status")).state, "stopped");
  assert.ok(workbench.isClosed(), "Stopping closes workbench but preserves controller");
  assert.ok(page.url().includes("tauri.localhost"));
  await page.getByRole("button", { name: "启动后台服务" }).click();
  await page.getByRole("heading", { name: "服务运行中", exact: true }).waitFor({ timeout: 50_000 });
  await page.getByRole("button", { name: "打开工作台" }).click();
  for (let i = 0; i < 50 && context.pages().length < 2; i++) await delay(100);
  workbench = context.pages().find((candidate) => candidate.url().startsWith(`http://127.0.0.1:${port}`));
  assert.ok(workbench);
  await page.getByRole("button", { name: "服务与更新" }).click();
  assert.ok(!workbench.isClosed(), "Switching back preserves the workbench WebView");
  assert.ok(!page.isClosed());
  assert.equal((await control("status")).state, "running");
  await page.getByRole("button", { name: "打开工作台" }).click();
  assert.equal(context.pages().length, 2);
  await inspectDesktopWindow(native.pid!);
  await closeWindow("Axiom2");
  for (let i = 0; i < 100 && native.exitCode === null; i++) await delay(100);
  assert.notEqual(native.exitCode, null, "Closing the single window with workbench visible must exit the desktop process");
  assert.equal((await control("status")).state, "running", "Native window closure must preserve the service");
  native = spawn(binary, [], { env, stdio: "ignore" });
  browser = await connectDesktop();
  context = browser.contexts()[0];
  context.setDefaultTimeout(15_000);
  for (let i = 0; i < 50; i++) {
    page = context.pages().find((candidate) => candidate.url().includes("tauri.localhost"));
    if (page) break;
    await delay(100);
  }
  assert.ok(page, "Reopening desktop restores the local controller");
  // Install the clock before the controller registers its polling interval.
  await page.clock.install();
  await page.reload();
  await page.getByRole("heading", { name: "服务运行中", exact: true }).waitFor();
  await page.getByRole("button", { name: "打开工作台" }).click();
  for (let i = 0; i < 50 && context.pages().length < 2; i++) await delay(100);
  workbench = context.pages().find((candidate) => candidate.url().startsWith(`http://127.0.0.1:${port}`));
  assert.ok(workbench);
  // Keep the old workbench alive even when the stop/start gap exceeds the poll interval.
  await page.clock.pauseAt(new Date(Date.now() + 100));
  await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke("axiom_service", { action: "status" }));
  assert.equal((await control("stop")).state, "stopped");
  let movedPort = await freePort();
  while (movedPort === port) movedPort = await freePort();
  env.AXIOM_PORT = String(movedPort);
  assert.equal((await control("start")).state, "running");
  assert.ok(!workbench.isClosed(), "Port-change check must retain the old workbench before open");
  await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke("axiom_service", { action: "open" }));
  for (let i = 0; i < 100 && !context.pages().some((candidate) => candidate.url().startsWith(`http://127.0.0.1:${movedPort}`)); i++) await delay(100);
  const movedWorkbench = context.pages().find((candidate) => candidate.url().startsWith(`http://127.0.0.1:${movedPort}`));
  assert.ok(movedWorkbench, "Opening must follow the current service origin after a port change");
  assert.ok(workbench.isClosed(), "The obsolete workbench must be destroyed");
  await movedWorkbench.getByRole("link", { name: "打开应用配置", exact: true }).waitFor();
  await inspectDesktopWindow(native.pid!);
  await page.clock.resume();
  native.kill();
  await delay(1000);
  assert.equal((await control("status")).state, "running", "Forced desktop exit must also preserve detached service");
  console.log("PASS: real Windows Pake/WebView2 single native window, child-view permission isolation, retained draft/selection/focus/scroll, native resize, offline control, startup cancellation, close/reopen, service port change, and service survival after normal/forced desktop exit.");
  completed = true;
} finally {
  try {
    if (native.exitCode === null && native.signalCode === null) {
      native.kill();
      const deadline = Date.now() + 10000;
      while (native.exitCode === null && native.signalCode === null) {
        if (Date.now() >= deadline) throw Error("Desktop exit is unconfirmed");
        await delay(50);
      }
    }
    await writeFile(join(data, "bootstrap-gate"), "");
    await writeFile(join(data, "initialize-gate"), "");
    const before = await control("status");
    assert.equal((await control("stop")).state, "stopped");
    const deadline = Date.now() + 5000;
    while (before.pid && isAlive(before.pid)) {
      if (Date.now() >= deadline) throw Error("Backend exit is unconfirmed");
      await delay(50);
    }
    try { await browser?.close(); } catch {}
    if (completed) await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    else console.error("Retained failed isolated desktop fixture:", root);
  } catch (error) { console.error("Retained isolated desktop fixture:", root); throw error; }
}
