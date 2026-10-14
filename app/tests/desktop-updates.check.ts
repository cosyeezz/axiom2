// Real Windows Pake/WebView2 updater check, using isolated npm/data and a local release fixture.
import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createServer as httpServer } from "node:http";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser } from "playwright";
if (process.platform !== "win32") throw Error("Requires Windows WebView2.");
assert.ok(process.env.AXIOM_UPDATE_OLD_TARBALL, "Set AXIOM_UPDATE_OLD_TARBALL to the published v0.2.3 tarball");
assert.ok(process.env.AXIOM_UPDATE_TARBALL, "Set AXIOM_UPDATE_TARBALL to the newly built tarball");
const run = promisify(execFile);
const temporary = await mkdtemp(join(tmpdir(), "axiom-native-update-"));
const root = join(temporary, "data"), prefix = join(temporary, "prefix"), pi = join(temporary, "pi");
await mkdir(root); await mkdir(pi);
const freePort = async () => { const server = createServer(); await new Promise<void>((done) => server.listen(0, "127.0.0.1", done)); const port = (server.address() as { port: number }).port; await new Promise<void>((done) => server.close(() => done())); return port; };
const port = await freePort();
const env = { ...process.env, AXIOM_DATA_DIR: root, AXIOM_PI_DIR: pi, PI_CODING_AGENT_DIR: pi, AXIOM_PORT: String(port) };
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
  native = spawn(resolve(process.env.AXIOM_DESKTOP_BINARY || "Axiom2-ServiceTest.exe"), [], { env: { ...env, AXIOM_UPDATE_TEST_ORIGIN: origin, AXIOM_DESKTOP_DEBUG_PORT: String(debugPort), WEBVIEW2_USER_DATA_FOLDER: join(temporary, `webview-${launched++}`) }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    if (native.exitCode !== null) throw Error(`Desktop exited: ${native.exitCode}`);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 1000 }); break; } catch { await delay(200); }
  }
  assert.ok(browser);
  const context = browser.contexts()[0]; context.setDefaultTimeout(20000);
  for (let i = 0; i < 50; i++) { const page = context.pages().find((page) => page.url().includes("tauri.localhost")); if (page) return page; await delay(100); }
  throw Error("Controller missing");
};
const killDesktop = async () => {
  if (native && native.exitCode === null) { const exited = new Promise<void>((done) => native!.once("exit", () => done())); native.kill(); await exited; }
  await browser?.close().catch(() => {}); browser = undefined;
};
try {
  const npm = process.env.npm_execpath || join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  await run(process.execPath, [npm, "install", "--global", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", process.env.AXIOM_UPDATE_OLD_TARBALL], { timeout: 240000 });
  assert.equal((await run(process.execPath, [cli, "--version"])).stdout.trim(), "0.2.3");
  assert.equal((await control("start")).state, "running");
  const workspace = join(temporary, "workspace"); await mkdir(workspace);
  const db = new DatabaseSync(join(root, "axiom.sqlite"));
  try {
    db.prepare("INSERT INTO workspaces(id,path,pathKey,name,authorized) VALUES(?,?,?,?,1)").run("upgrade-workspace", workspace, workspace.toLowerCase(), "更新保留项目");
    db.prepare("INSERT INTO sessions(id,workspaceId,title,updatedAt) VALUES(?,?,?,?)").run("upgrade-session", "upgrade-workspace", "更新保留会话", Date.now());
  } finally { db.close(); }
  let page = await launch();
  await page.getByRole("heading", { name: "服务运行中", exact: true }).waitFor();
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await page.getByRole("button", { name: `更新后台服务 · ${version}`, exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: `更新后台服务 · ${version}`, exact: true }).click();
  await page.getByText("应用内更新与恢复要求此安装仅用于当前数据目录。", { exact: false }).waitFor();
  assert.equal(await page.getByRole("button", { name: "确认更新服务", exact: true }).evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
  }), true, "Shared-install restriction must leave confirmation accessible in a narrow window");
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/desktop-update-confirm-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "暂不更新", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal((await control("status")).state, "running", "Cancelling update confirmation must leave the service running");
  await page.getByRole("button", { name: `更新后台服务 · ${version}`, exact: true }).click();
  await page.getByRole("button", { name: "确认更新服务", exact: true }).click();
  await Promise.race([downloadStarted, delay(20000).then(() => { throw Error("Updater never started download"); })]);
  await page.getByText("正在下载 axiom2.tgz…", { exact: true }).waitFor();
  await killDesktop();
  assert.equal((await control("status")).state, "running", "Preparing an update must not stop the old backend");
  page = await launch();
  await page.getByText("正在下载 axiom2.tgz…", { exact: true }).waitFor();
  releaseDownload();
  await page.getByText(`后台服务已更新至 ${version}，现在可以打开工作台。`, { exact: true }).waitFor({ timeout: 240000 });
  await page.getByRole("heading", { name: "服务运行中", exact: true }).waitFor();
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
  const parts = version.split(".").map(Number); parts[2]++;
  releaseVersion = parts.join(".");
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await page.getByRole("button", { name: "下载客户端更新", exact: true }).click();
  await page.getByRole("button", { name: "运行安装器", exact: true }).waitFor();
  const installer = (await readdir(join(root, "updates"))).find((name) => name.endsWith("-Axiom2.msi"));
  assert.ok(installer);
  await writeFile(join(root, "updates", installer), "tampered after verification");
  await page.getByRole("button", { name: "运行安装器", exact: true }).click();
  await page.getByRole("button", { name: "打开安装向导", exact: true }).click();
  await page.getByText("安装包已变化或不可用，请重新下载。", { exact: true }).waitFor();
  assert.equal(native!.exitCode, null, "Rejected installer must not close the desktop or launch msiexec");
  await page.getByRole("button", { name: "运行安装器", exact: true }).waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.screenshot({ path: "test-results/desktop-update-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "test-results/desktop-update.png", fullPage: true });
  console.log("PASS: real Windows desktop upgrades published v0.2.3, survives desktop exit/reopen, preserves sessions and CLI path, rejects remote update access and tampered installers, and fits narrow windows.");
} finally {
  releaseDownload();
  await killDesktop();
  // Give an owned in-progress update time to settle before removing its fixture.
  const helper = join(root, "updates", `desktop-updater-${version}.mjs`);
  for (let i = 0; i < 120; i++) {
    try { const state = JSON.parse((await run(process.execPath, [helper, "status"], { env, timeout: 10000 })).stdout); if (!state.job?.running) break; } catch { break; }
    await delay(1000);
  }
  await control("stop").catch(() => {});
  fixture.closeAllConnections(); await new Promise<void>((done) => fixture.close(() => done()));
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
