import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Workspace, Session } from "../src/shared/protocol.js";

// Collapsed/expanded layout state survives refresh: the phone reading mode (title bar),
// the Android native entry and the desktop sidebar.
const root = mkdtempSync(join(tmpdir(), "axiom-collapse-"));
mkdirSync(join(root, "pi")); mkdirSync(join(root, "project"));
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
const app = await startServer({ root, port: 0, dev: process.env.AXIOM_TEST_PRODUCTION !== "1" });
const artifacts = resolve(process.env.AXIOM_COLLAPSE_ARTIFACTS ?? "test-results/collapse-persistence");
mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "project"), authorized: true } }) as Workspace;
const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
const scope = { workspaceId: workspace.id, sessionId: session.id };
const titleBar = "#content>.topnav";
async function entry(options: Parameters<typeof browser.newContext>[0], hash = "") {
  const context = await browser.newContext(options);
  await context.route("**/@vite/client", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("async function handleMessage(payload) {", "async function handleMessage(payload) { return;") });
  });
  const page = await context.newPage();
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((scope) => sessionStorage.setItem("view", JSON.stringify(scope)), scope);
  let loaded = false;
  const load = async () => {
    // A same-URL goto would be a same-document hash navigation, so repeat visits must reload.
    if (loaded) await page.reload(); else { await page.goto(app.origin + hash); loaded = true; }
    await page.locator(".app .workspace").waitFor();
    await page.waitForTimeout(300);
  };
  await load();
  return { page, errors, load, context };
}
const phone: Parameters<typeof browser.newContext>[0] = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
const desktop: Parameters<typeof browser.newContext>[0] = { viewport: { width: 1440, height: 900 } };
try {
  // A phone browser keeps the reader's choice across refresh, in both directions.
  const mobile = await entry(phone);
  try {
    assert.equal(await mobile.page.locator(titleBar).isVisible(), true, "a fresh phone opens with the title bar expanded");
    assert.equal(await mobile.page.getByRole("button", { name: "收起标题栏" }).count(), 0, "the desktop toggle stays out of the phone layout");
    await mobile.page.getByRole("button", { name: "收起工作台，只看对话" }).click();
    assert.equal(await mobile.page.locator(titleBar).isVisible(), false);
    await mobile.load();
    assert.equal(await mobile.page.locator(titleBar).isVisible(), false, "refresh keeps the collapsed title bar");
    await mobile.page.screenshot({ animations: "disabled", path: join(artifacts, "phone-collapsed-after-reload.png") });
    await mobile.page.getByRole("button", { name: "展开工作台", exact: true }).click();
    assert.equal(await mobile.page.locator(titleBar).isVisible(), true);
    await mobile.load();
    assert.equal(await mobile.page.locator(titleBar).isVisible(), true, "refresh keeps the expanded title bar");
    assert.deepEqual(mobile.errors, []);
  } finally { await mobile.context.close(); }

  // The Android entry still defaults to reading, but an explicit expand survives refresh.
  const android = await entry(phone, "#axiom-native=1");
  try {
    assert.equal(await android.page.locator(titleBar).isVisible(), false, "the Android entry still starts in reading mode");
    await android.page.getByRole("button", { name: "展开工作台", exact: true }).click();
    assert.equal(await android.page.locator(titleBar).isVisible(), true);
    await android.load();
    assert.equal(await android.page.locator(titleBar).isVisible(), true, "Android keeps the explicit expand across refresh");
    await android.page.screenshot({ animations: "disabled", path: join(artifacts, "android-expanded-after-reload.png") });
    await android.page.getByRole("button", { name: "收起工作台，只看对话" }).click();
    await android.load();
    assert.equal(await android.page.locator(titleBar).isVisible(), false, "Android keeps an explicit collapse across refresh");
    assert.deepEqual(android.errors, []);
  } finally { await android.context.close(); }

  // The desktop sidebar's collapse button keeps working across refreshes.
  const wide = await entry(desktop);
  try {
    assert.equal(await wide.page.locator(".sidebar").isVisible(), true, "a fresh window shows the sidebar");
    assert.equal(await wide.page.locator(titleBar).isVisible(), true, "a fresh window shows the title bar");
    await wide.page.getByRole("button", { name: "收起侧栏", exact: true }).click();
    assert.equal(await wide.page.locator(".sidebar").isVisible(), false);
    assert.equal(await wide.page.locator(titleBar).isVisible(), true, "collapsing the sidebar keeps the title bar");
    await wide.page.screenshot({ animations: "disabled", path: join(artifacts, "desktop-sidebar-collapsed.png") });
    await wide.load();
    assert.equal(await wide.page.locator(".sidebar").isVisible(), false, "refresh keeps the desktop sidebar collapsed");
    assert.equal(await wide.page.evaluate(() => localStorage.getItem("axiom.sidebar.collapsed")), "true");
    await wide.page.getByRole("button", { name: "展开侧栏", exact: true }).click();
    assert.equal(await wide.page.locator(".sidebar").isVisible(), true);
    await wide.load();
    assert.equal(await wide.page.locator(".sidebar").isVisible(), true, "refresh keeps the desktop sidebar expanded");
    assert.equal(await wide.page.evaluate(() => localStorage.getItem("axiom.sidebar.collapsed")), "false");
    assert.equal(await wide.page.locator("#prompt").isVisible(), true);
    await wide.page.screenshot({ animations: "disabled", path: join(artifacts, "desktop-sidebar-expanded-after-reload.png") });
    assert.deepEqual(wide.errors, []);
  } finally { await wide.context.close(); }
  console.log("collapse persistence ok", artifacts);
} finally {
  await browser.close();
  await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
}