import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
import { tmpdir } from "./temporary.js";
const root = mkdtempSync(join(tmpdir(), "axiom-icon-gallery-preview-"));
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS || "test-results/icon-gallery-preview");
mkdirSync(artifacts, { recursive: true }); mkdirSync(join(root, "pi"));
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
copyFileSync(resolve("../artifacts/workspace-directory-icons/index.html"), join(root, "index.html"));
const candidates = JSON.parse(readFileSync(resolve("../artifacts/workspace-directory-icons/candidates.json"), "utf8"));
const app = await startServer({ root: join(root, "data"), port: 0, dev: true });
const browser = process.env.AXIOM_TEST_ENGINE === "webkit"
  ? await webkit.launch()
  : await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const messages: string[] = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("console", message => messages.push(`${message.type()}: ${message.text()}`));
page.on("pageerror", error => messages.push(`pageerror: ${error.message}`));
const inspect = async () => {
  const frames = [];
  for (const frame of page.frames()) {
    try { frames.push(await frame.evaluate(() => ({ url: location.href, title: document.title, text: document.body?.innerText.slice(0, 500), html: document.documentElement?.outerHTML.slice(0, 1200), rect: { width: innerWidth, height: innerHeight } }))); }
    catch (error) { frames.push({ error: String(error), url: frame.url() }); }
  }
  writeFileSync(join(artifacts, "diagnostic.json"), JSON.stringify({ messages, frames }, null, 2));
};
try {
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  app.store.execute({ requestId: crypto.randomUUID(), op: "session.rename", ...scope, params: { title: "图标隔离预览回归" } });
  const views = (app.agents as unknown as { views: AgentViews }).views;
  views.messageChanged(scope, { id: "gallery-reply", role: "assistant", text: "[打开50个图标选择页](index.html)" }); views.flush(scope);
  await page.addInitScript(value => { if (window === window.top && location.protocol === "http:") sessionStorage.setItem("view", JSON.stringify(value)); }, scope);
  await page.goto(app.origin);
  await page.getByRole("button", { name: "打开50个图标选择页", exact: true }).click();
  await page.locator('.file-preview-body[aria-busy="false"]').waitFor();
  const gallery = page.frameLocator(".file-html-frame").frameLocator("iframe");
  await gallery.getByRole("heading", { name: "工作空间目录图标 · 50 个 SVG 候选", exact: true }).waitFor({ timeout: 10000 });
  assert.equal(await gallery.locator(".card .icon svg").count(), 50);
  for (const candidate of candidates) {
    await gallery.getByRole("button", { name: `选择 ${String(candidate.number).padStart(2, "0")} ${candidate.label}`, exact: true }).click();
    assert.equal(await gallery.locator("#selection").textContent(), `${String(candidate.number).padStart(2, "0")} · ${candidate.label} · ${candidate.name}`);
    assert.equal(await gallery.locator("#source").getAttribute("href"), candidate.websiteUrl);
  }
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await gallery.getByRole("heading", { name: "工作空间目录图标 · 50 个 SVG 候选", exact: true }).scrollIntoViewIfNeeded();
    const body = gallery.locator("body");
    assert.ok(await body.evaluate(node => node.ownerDocument.documentElement.scrollWidth <= node.ownerDocument.defaultView!.innerWidth + 1), `gallery fits preview at ${width}`);
    await page.screenshot({ path: join(artifacts, `gallery-in-app-${width}.png`) });
  }
  await page.getByRole("button", { name: "停用页面脚本", exact: true }).click();
  await gallery.getByRole("heading", { name: "工作空间目录图标 · 50 个 SVG 候选", exact: true }).waitFor();
  assert.equal(await gallery.locator(".card .icon svg").count(), 50, "SVG choices remain visible without scripts");
  await page.getByRole("button", { name: "禁止普通联网", exact: true }).click();
  assert.equal(await gallery.locator(".card .icon svg").count(), 50, "SVG choices require no network");
  assert.equal(await page.locator(".file-html-frame").getAttribute("sandbox"), "");
  await page.getByRole("button", { name: "启用页面脚本", exact: true }).click();
  await gallery.getByRole("button", { name: "选择 11 目录树", exact: true }).click();
  assert.equal(await gallery.locator("#selection").textContent(), "11 · 目录树 · folder-tree");
  assert.equal(await page.locator(".file-html-frame").getAttribute("sandbox"), "allow-scripts");
  assert.equal(await page.frameLocator(".file-html-frame").locator("iframe").getAttribute("sandbox"), "allow-scripts");
  await inspect();
  console.log(`PASS actual Axiom preview: 50 SVGs and choices, 390–1440px, scripts/network toggles, unchanged sandbox. Artifacts: ${artifacts}`);
} catch (error) {
  await inspect(); await page.screenshot({ path: join(artifacts, "failure.png") }); throw error;
} finally {
  await browser.close(); await app.close(); rmSync(root, { recursive: true, force: true });
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
}
