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
  WEBVIEW2_USER_DATA_FOLDER: join(root, "webview"), AXIOM_DESKTOP_DEBUG_PORT: String(debugPort) };
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
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "Controller must fit narrow windows");
  await page.screenshot({ path: "test-results/desktop-service-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 900 });
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
  await page.getByRole("button", { name: "打开工作台" }).click();
  for (let i = 0; i < 30 && context.pages().length < 2; i++) await delay(200);
  let workbench = context.pages().find((candidate) => candidate.url().startsWith(`http://127.0.0.1:${port}`));
  assert.ok(workbench, "Ready service opens in a separate workbench window");
  await workbench.getByRole("link", { name: "打开应用配置", exact: true }).waitFor();
  await workbench.getByRole("link", { name: "打开应用配置", exact: true }).click();
  await workbench.getByRole("heading", { name: "模型服务", exact: true }).waitFor();
  const denied = await workbench.evaluate(async () => {
    const bridge = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (name: string, args: object) => Promise<unknown> } }).__TAURI_INTERNALS__;
    if (!bridge) return true;
    try { await bridge.invoke("axiom_service", { action: "stop" }); return false; } catch { return true; }
  });
  assert.equal(denied, true, "Remote workbench must not invoke native service control");
  assert.equal((await control("status")).state, "running");
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
  await closeWindow("Axiom2 · 工作台");
  for (let i = 0; i < 100 && !workbench.isClosed(); i++) await delay(100);
  assert.ok(workbench.isClosed(), "Closing workbench leaves the controller available");
  assert.ok(!page.isClosed());
  assert.equal((await control("status")).state, "running");
  await page.getByRole("button", { name: "打开工作台" }).click();
  for (let i = 0; i < 50 && context.pages().length < 2; i++) await delay(100);
  assert.equal(context.pages().length, 2);
  await closeWindow("Axiom2");
  for (let i = 0; i < 100 && native.exitCode === null; i++) await delay(100);
  assert.notEqual(native.exitCode, null, "Closing controller with workbench open must exit the desktop process");
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
  await page.clock.resume();
  native.kill();
  await delay(1000);
  assert.equal((await control("status")).state, "running", "Forced desktop exit must also preserve detached service");
  console.log("PASS: real Windows Pake/WebView2 offline control, startup cancellation, authenticated service management, native window close/reopen, service port change, and service survival after normal/forced desktop exit.");
} finally {
  native.kill();
  await writeFile(join(data, "bootstrap-gate"), "").catch(() => {});
  await writeFile(join(data, "initialize-gate"), "").catch(() => {});
  try { await control("stop"); } catch {}
  try { await browser?.close(); } catch {}
  await delay(500);
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
