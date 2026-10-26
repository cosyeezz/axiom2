// Real Windows Pake/WebView2 updater check, using isolated npm/data and a local release fixture.
import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createServer as httpServer } from "node:http";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type Page } from "playwright";
import { inspectDesktopWindow } from "./desktop-window.js";
import { waitForUpdateExit, type UpdateCleanupJob } from "./desktop-update-cleanup.js";
const { installerRecordName } = await import(new URL("../../scripts/desktop-test-bridge.mjs", import.meta.url).href);
if (process.platform !== "win32") throw Error("Requires Windows WebView2.");
assert.ok(process.env.AXIOM_UPDATE_OLD_TARBALL, "Set AXIOM_UPDATE_OLD_TARBALL to the published v0.2.3 tarball");
assert.ok(process.env.AXIOM_UPDATE_TARBALL, "Set AXIOM_UPDATE_TARBALL to the newly built tarball");
const run = promisify(execFile);
const binary = resolve(process.env.AXIOM_DESKTOP_BINARY || "Axiom2-ServiceTest.exe");
assert.ok((await readFile(binary)).includes(Buffer.from(installerRecordName)), "Use a --test-instance build with the installer recording replacement; never execute the fixture MSI");
const temporary = await mkdtemp(join(tmpdir(), "axiom-native-update-"));
const root = join(temporary, "data"), prefix = join(temporary, "prefix"), pi = join(temporary, "pi");
await mkdir(root); await mkdir(pi);
const freePort = async () => { const server = createServer(); await new Promise<void>((done) => server.listen(0, "127.0.0.1", done)); const port = (server.address() as { port: number }).port; await new Promise<void>((done) => server.close(() => done())); return port; };
const port = await freePort();
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "npm_config_cache")),
  AXIOM_DATA_DIR: root, AXIOM_PI_DIR: pi, PI_CODING_AGENT_DIR: pi, AXIOM_PORT: String(port), npm_config_cache: join(temporary, "npm-cache") };
const installerRecord = join(root, installerRecordName);
const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; } };
const readUpdateJob = async (): Promise<UpdateCleanupJob | null> => {
  const file = join(root, "updates/jobs.sqlite");
  try { await access(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare("SELECT token,pid,body FROM job WHERE id=1").get() as { token: string; pid: number; body: string } | undefined;
    return row ? { ...JSON.parse(row.body), token: row.token, pid: row.pid } : null;
  } finally { db.close(); }
};
// A new launch may not have claimed its row yet when an assertion fails. Never
// mistake the previous completed job for the most recently requested update.
let previousToken: string | null | undefined;
const requestingUpdate = async () => { previousToken = (await readUpdateJob())?.token ?? null; };
let backendMayRun = false, testFailed = false;
const cli = join(prefix, "node_modules/@cosyeezz/axiom2/bin/axiom2.mjs");
const control = async (action: string) => JSON.parse((await run(process.execPath, [cli, action, "--json"], { env, timeout: 55000 })).stdout);
const version = JSON.parse(await readFile(resolve("../package.json"), "utf8")).version;
const tarball = await readFile(process.env.AXIOM_UPDATE_TARBALL);
const msi = Buffer.from("test installer - never execute");
let releaseVersion = version;
let releaseDownload!: () => void, downloadEntered!: () => void;
const downloadGate = new Promise<void>((done) => { releaseDownload = done; });
const downloadStarted = new Promise<void>((done) => { downloadEntered = done; });
let origin = "";
const fixture = httpServer(async (req, res) => {
  if (req.url === "/latest") {
    const assets = [["axiom2.tgz", tarball], ["Axiom2.msi", msi]] as const;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ tag_name: `v${releaseVersion}`, draft: false, prerelease: false, assets: assets.map(([name, bytes]) => ({ name, size: bytes.length, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, browser_download_url: `${origin}/download/v${releaseVersion}/${name}` })) }));
  } else if (req.url?.endsWith("/axiom2.tgz")) { downloadEntered(); await downloadGate; res.end(tarball); }
  else if (req.url?.endsWith("/Axiom2.msi")) res.end(msi);
  else { res.writeHead(404); res.end(); }
});
await new Promise<void>((done) => fixture.listen(0, "127.0.0.1", done));
origin = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`;
let native: ChildProcess | undefined, browser: Browser | undefined;
let launched = 0;
const launch = async () => {
  const debugPort = await freePort();
  native = spawn(binary, [], { env: { ...env, AXIOM_UPDATE_TEST_ORIGIN: origin, AXIOM_DESKTOP_DEBUG_PORT: String(debugPort), WEBVIEW2_USER_DATA_FOLDER: join(temporary, `webview-${launched++}`) }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    if (native.exitCode !== null) throw Error(`Desktop exited: ${native.exitCode}`);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 1000 }); break; } catch { await delay(200); }
  }
  assert.ok(browser);
  const context = browser.contexts()[0]; context.setDefaultTimeout(20000);
  for (let i = 0; i < 50; i++) { const page = context.pages().find((page) => page.url().includes("tauri.localhost")); if (page) return page; await delay(100); }
  throw Error("Controller missing");
};
const expandSection = async (page: Page, selector: ".startup-preparation" | ".startup-maintenance") => {
  const section = page.locator(selector);
  if (await section.getAttribute("open") === null) await section.locator(":scope > summary").click();
};
const killDesktop = async () => {
  if (native && native.exitCode === null && native.signalCode === null) {
    native.kill();
    const deadline = Date.now() + 10000;
    while (native.exitCode === null && native.signalCode === null) {
      if (Date.now() >= deadline) throw Error("Desktop cleanup exit is unconfirmed");
      await delay(50);
    }
  }
  await browser?.close().catch(() => {}); browser = undefined;
};
try {
  const npm = process.env.npm_execpath || join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  await run(process.execPath, [npm, "install", "--global", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", process.env.AXIOM_UPDATE_OLD_TARBALL], { env, timeout: 600000 });
  assert.equal((await run(process.execPath, [cli, "--version"], { env })).stdout.trim(), "0.2.3");
  backendMayRun = true;
  assert.equal((await control("start")).state, "running");
  const workspace = join(temporary, "workspace"); await mkdir(workspace);
  const db = new DatabaseSync(join(root, "axiom.sqlite"));
  try {
    db.prepare("INSERT INTO workspaces(id,path,pathKey,name,authorized) VALUES(?,?,?,?,1)").run("upgrade-workspace", workspace, workspace.toLowerCase(), "更新保留项目");
    db.prepare("INSERT INTO sessions(id,workspaceId,title,updatedAt) VALUES(?,?,?,?)").run("upgrade-session", "upgrade-workspace", "更新保留会话", Date.now());
  } finally { db.close(); }
  let page = await launch();
  await page.locator('.connection-status-tag[data-state="running"]').waitFor();
  await expandSection(page, ".startup-preparation");
  await page.getByRole("button", { name: "打开工作台" }).click();
  for (let i = 0; i < 50 && browser!.contexts()[0].pages().length < 2; i++) await delay(100);
  const oldWorkbench = browser!.contexts()[0].pages().find((candidate) => candidate.url().startsWith(`http://127.0.0.1:${port}`));
  assert.ok(oldWorkbench);
  await inspectDesktopWindow(native!.pid!);
  await page.getByRole("button", { name: "服务与更新" }).click();
  assert.ok(!oldWorkbench.isClosed(), "Returning to updates must retain the workbench until update confirmation");
  await expandSection(page, ".startup-maintenance");
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await page.getByRole("button", { name: `更新后台服务 · ${version}`, exact: true }).waitFor();
  await inspectDesktopWindow(native!.pid!, { width: 430, height: 900 });
  await page.waitForFunction(() => innerWidth < 500);
  await page.getByRole("button", { name: `更新后台服务 · ${version}`, exact: true }).click();
  await page.getByText("应用内更新与恢复要求此安装仅用于当前数据目录。", { exact: false }).waitFor();
  assert.equal(await page.getByRole("button", { name: "确认更新服务", exact: true }).evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
  }), true, "Shared-install restriction must leave confirmation accessible in a narrow window");
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/desktop-update-confirm-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "暂不更新", exact: true }).click();
  await inspectDesktopWindow(native!.pid!, { width: 1456, height: 1039 });
  await page.waitForFunction(() => innerWidth > 1000);
  assert.equal((await control("status")).state, "running", "Cancelling update confirmation must leave the service running");
  await page.getByRole("button", { name: `更新后台服务 · ${version}`, exact: true }).click();
  await requestingUpdate();
  await page.getByRole("button", { name: "确认更新服务", exact: true }).click();
  await Promise.race([downloadStarted, delay(20000).then(() => { throw Error("Updater never started download"); })]);
  await page.getByText("正在下载 axiom2.tgz…", { exact: true }).waitFor();
  for (let i = 0; i < 50 && !oldWorkbench.isClosed(); i++) await delay(100);
  assert.ok(oldWorkbench.isClosed(), "Confirmed backend update must discard the workbench while preserving the control page");
  await killDesktop();
  assert.equal((await control("status")).state, "running", "Preparing an update must not stop the old backend");
  page = await launch();
  await expandSection(page, ".startup-maintenance");
  await page.getByText("正在下载 axiom2.tgz…", { exact: true }).waitFor();
  releaseDownload();
  await page.getByText(`后台服务已更新至 ${version}，现在可以打开工作台。`, { exact: true }).waitFor({ timeout: 900000 });
  await page.locator('.connection-status-tag[data-state="running"]').waitFor();
  await expandSection(page, ".startup-preparation");
  assert.equal((await control("status")).version, version);
  assert.equal((await run(process.execPath, [cli, "--version"])).stdout.trim(), version);
  const restored = new DatabaseSync(join(root, "axiom.sqlite"));
  try { assert.equal(restored.prepare("SELECT title FROM sessions WHERE id=?").get("upgrade-session")?.title, "更新保留会话"); }
  finally { restored.close(); }
  await page.getByRole("button", { name: "打开工作台", exact: false }).click();
  for (let i = 0; i < 50 && !browser!.contexts()[0].pages().some((p) => p.url().startsWith(`http://127.0.0.1:${port}`)); i++) await delay(100);
  const workbench = browser!.contexts()[0].pages().find((p) => p.url().startsWith(`http://127.0.0.1:${port}`));
  assert.ok(workbench);
  assert.equal(await workbench.evaluate(async () => {
    const bridge = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (command: string, args: object) => Promise<unknown> } }).__TAURI_INTERNALS__;
    if (!bridge) return true;
    try { await bridge.invoke("axiom_update", { action: "service", version: "999.0.0" }); return false; } catch { return true; }
  }), true, "Remote workbench must not invoke updater");
  await inspectDesktopWindow(native!.pid!);
  await page.getByRole("button", { name: "服务与更新" }).click();
  await expandSection(page, ".startup-maintenance");
  const parts = version.split(".").map(Number); parts[2]++;
  releaseVersion = parts.join(".");
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await requestingUpdate();
  await page.getByRole("button", { name: "下载客户端更新", exact: true }).click();
  await page.getByRole("button", { name: "运行安装器", exact: true }).waitFor();
  const installer = (await readdir(join(root, "updates"))).find((name) => name.endsWith("-Axiom2.msi"));
  assert.ok(installer);
  await writeFile(join(root, "updates", installer), "tampered after verification");
  await page.getByRole("button", { name: "运行安装器", exact: true }).click();
  await page.getByRole("button", { name: "打开安装向导", exact: true }).click();
  await page.getByText("安装包已变化或不可用，请重新下载。", { exact: true }).waitFor();
  assert.equal(native!.exitCode, null, "Rejected installer must leave the desktop running");
  await assert.rejects(access(installerRecord), { code: "ENOENT" }, "Tampered MSI must never reach the native installer launch");
  await page.getByRole("button", { name: "运行安装器", exact: true }).waitFor({ state: "hidden" });
  await inspectDesktopWindow(native!.pid!, { width: 430, height: 900 });
  await page.waitForFunction(() => innerWidth < 500);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: "test-results/desktop-update-mobile.png", fullPage: true });
  await inspectDesktopWindow(native!.pid!, { width: 1456, height: 1039 });
  await page.waitForFunction(() => innerWidth > 1000);
  await page.screenshot({ path: "test-results/desktop-update.png", fullPage: true });
  // A valid fixture reaches the same native command construction, but the test
  // binary records it instead of starting Windows Installer.
  await requestingUpdate();
  await page.getByRole("button", { name: "下载客户端更新", exact: true }).click();
  await page.getByRole("button", { name: "运行安装器", exact: true }).waitFor();
  assert.deepEqual(await readFile(join(root, "updates", installer)), msi);
  await page.getByRole("button", { name: "运行安装器", exact: true }).click();
  const desktopExited = new Promise<void>((done) => native!.once("exit", () => done()));
  await page.getByRole("button", { name: "打开安装向导", exact: true }).click();
  await Promise.race([desktopExited, delay(10000, undefined, { ref: false }).then(() => { throw Error("Desktop did not exit after the recorded installer launch"); })]);
  assert.equal(native!.exitCode, 0);
  const launches = (await readFile(installerRecord, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(launches.length, 1, "Only the verified fixture may reach installer launch");
  assert.ok(process.env.SystemRoot);
  assert.equal(resolve(launches[0].program), resolve(process.env.SystemRoot, "System32/msiexec.exe"));
  assert.deepEqual(launches[0].args, ["/i", join(root, "updates", installer)]);
  assert.equal((await control("status")).state, "running", "Opening the installer must preserve the backend");
} catch (error) {
  testFailed = true;
  throw error;
} finally {
  releaseDownload();
  try {
    await killDesktop();
    if (previousToken === undefined) {
      if (backendMayRun) await control("stop");
      throw Error("No update job was submitted; retaining the failed setup for diagnosis.");
    }
    await waitForUpdateExit({ readJob: readUpdateJob, isAlive, previousToken });
    const before = await control("status");
    assert.equal((await control("stop")).state, "stopped");
    const deadline = Date.now() + 5000;
    while (before.pid && isAlive(before.pid)) {
      if (Date.now() >= deadline) throw Error("Backend exit is unconfirmed; retain the fixture.");
      await delay(50);
    }
    await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (error) {
    console.error("Retained isolated updater fixture:", temporary, error);
    if (!testFailed) throw error;
  } finally {
    fixture.closeAllConnections(); await new Promise<void>((done) => fixture.close(() => done()));
  }
}
console.log("PASS: real Windows desktop upgrade/reopen and session preservation; tampered MSI records zero launches; verified MSI records exactly the native executable and /i path then exits without stopping the backend; narrow layout and confirmed-exit cleanup; isolated npm cache.");
