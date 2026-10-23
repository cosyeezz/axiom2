import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-reload-ui-")), cwd = join(root, "project"), pi = join(root, "pi");
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS ?? "test-results", "session-reload");
for (const path of [cwd, pi, artifacts]) mkdirSync(path, { recursive: true });
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = pi;
let requests = 0;
const http = createServer((_req, res) => { requests++; res.writeHead(500); res.end("cold reload must not infer"); });
await new Promise<void>(r => http.listen(0, "127.0.0.1", r));
writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: `http://127.0.0.1:${(http.address() as any).port}/v1`, models: [{ id: "fixture", contextWindow: 32000, maxTokens: 256 }] } } }));
writeFileSync(join(pi, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "loopback-only" } }));
writeFileSync(join(cwd, "AGENTS.md"), "Reload UI fixture V1");
const app = await startServer({ root, port: 0, dev: true });
const browser = await chromium.launch(process.env.AXIOM_TEST_BROWSER ? { executablePath: process.env.AXIOM_TEST_BROWSER } : { channel: "chrome" });
try {
  const w = app.store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: cwd, authorized: true } }) as Workspace;
  const s = app.store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: w.id }) as Session;
  const scope = { workspaceId: w.id, sessionId: s.id };
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(s.id, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(view => sessionStorage.setItem("view", JSON.stringify(view)), scope);
  const page = await context.newPage(), other = await context.newPage(), errors: string[] = [];
  for (const p of [page, other]) { p.setDefaultTimeout(20000); p.on("pageerror", e => errors.push(e.message)); await p.goto(app.accessUrl); }
  let navigations = 0, otherNavigations = 0;
  page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations++; });
  other.on("framenavigated", frame => { if (frame === other.mainFrame()) otherNavigations++; });
  const trigger = page.getByRole("button", { name: "重新加载会话配置", exact: true });
  const dialog = page.getByRole("dialog", { name: "重新加载会话", exact: true });
  await page.locator("#prompt").fill("重载期间保留我的草稿");
  await trigger.click(); await dialog.waitFor();
  await other.getByRole("button", { name: "重新加载会话配置", exact: true }).click();
  await Promise.all([
    page.waitForEvent("framenavigated", frame => frame === page.mainFrame()),
    dialog.getByRole("button", { name: "重新加载会话", exact: true }).click(),
  ]);
  await trigger.click();
  await dialog.locator(".reload-status").filter({ hasText: "重载完成" }).waitFor();
  await other.locator(".reload-status").filter({ hasText: "重载完成" }).waitFor();
  assert.equal(requests, 0);
  assert.equal(app.store.db.prepare("SELECT COUNT(*) AS n FROM runs").get()!.n, 0);
  await page.waitForFunction(() => (document.querySelector("#prompt") as HTMLTextAreaElement)?.value === "重载期间保留我的草稿");
  assert.equal(navigations, 1); assert.equal(otherNavigations, 0, "observing windows must not refresh");
  await page.screenshot({ path: join(artifacts, "desktop.png") });
  await page.keyboard.press("Escape"); await dialog.waitFor({ state: "hidden" });
  assert.ok(await trigger.evaluate(node => document.activeElement === node));
  writeFileSync(join(cwd, "AGENTS.md"), "Reload UI fixture V2");
  let releaseDraft!: () => void;
  const draftGate = new Promise<void>(resolve => { releaseDraft = resolve; });
  await page.route("**/api/draft?*", async route => { if (route.request().method() === "POST") await draftGate; await route.continue(); });
  await page.locator("#prompt").fill("刷新前等待保存的最新草稿");
  await trigger.click(); await dialog.getByRole("button", { name: "重新加载会话", exact: true }).click();
  await dialog.getByRole("button", { name: "关闭重载详情" }).click();
  await other.waitForFunction(() => document.querySelector(".reload-table")?.textContent?.includes("~1"));
  assert.equal(navigations, 1, "must wait for the draft save before refreshing");
  await Promise.all([page.waitForEvent("framenavigated", frame => frame === page.mainFrame()), Promise.resolve().then(releaseDraft)]);
  await page.unroute("**/api/draft?*");
  await trigger.click();
  await page.waitForFunction(() => (document.querySelector("#prompt") as HTMLTextAreaElement)?.value === "刷新前等待保存的最新草稿");
  assert.equal(navigations, 2, "closing the dialog must not cancel the requested refresh");
  await page.waitForFunction(() => document.querySelector(".reload-status")?.textContent?.includes("重载完成") && document.querySelector(".reload-table")?.textContent?.includes("~1"));
  for (const [width, height] of [[390, 844], [390, 480], [820, 700]]) {
    await page.setViewportSize({ width, height });
    const box = await dialog.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= height + 1, JSON.stringify(box));
    const button = await dialog.getByRole("button", { name: "重新加载会话", exact: true }).boundingBox(); assert.ok(button && button.height >= 44 && button.y + button.height <= height);
    await page.screenshot({ path: join(artifacts, `${width}-${height}.png`) });
  }
  await page.keyboard.press("Escape");
  await page.reload(); await trigger.click();
  await dialog.locator(".reload-status").filter({ hasText: "重载完成" }).waitFor();
  assert.equal(navigations, 3, "restoring an old success must not reload again");
  app.store.db.prepare("UPDATE workspaces SET authorized=0 WHERE id=?").run(w.id);
  await dialog.getByRole("button", { name: "重新加载会话", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "授权" }).waitFor();
  assert.equal(navigations, 3, "rejected reload must not refresh");
  app.store.db.prepare("UPDATE workspaces SET authorized=1 WHERE id=?").run(w.id);
  for (const status of [503, 409]) {
    await page.route("**/api/draft?*", route => route.request().method() === "POST" ? route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ code: status === 409 ? "DRAFT_CONFLICT" : "DRAFT_UNAVAILABLE", error: "draft fixture unavailable" }) }) : route.continue());
    const text = `保存异常 ${status} 时不要丢掉草稿`;
    const failedSave = page.waitForResponse(response => response.url().includes("/api/draft?") && response.status() === status);
    await page.locator("#prompt").fill(text);
    await (await failedSave).finished();
    await dialog.getByRole("button", { name: "重新加载会话", exact: true }).click();
    await page.waitForFunction(() => {
      const button = document.querySelector<HTMLButtonElement>(".reload-submit");
      return button && !button.disabled && document.querySelector(".reload-status")?.textContent?.includes("重载完成");
    });
    assert.equal(await dialog.getByRole("alert").count(), 0, "draft errors must remain silent after reload");
    assert.equal(await page.locator(".draft-status").count(), 0);
    assert.equal(navigations, 3, "draft save failure or conflict must retain the page");
    assert.equal(await page.locator("#prompt").inputValue(), text);
    await page.unroute("**/api/draft?*");
  }
  assert.equal(otherNavigations, 0); assert.equal(requests, 0); assert.deepEqual(errors, []);
  const gallery = await browser.newPage();
  await gallery.goto(`file://${resolve("design-previews/reload-icons/gallery.html")}`);
  assert.equal(await gallery.locator(".glyph svg").count(), 50);
  assert.ok(await gallery.locator(".glyph svg").evaluateAll(icons => icons.every(icon => { const bounds = (icon as SVGSVGElement).getBBox(); return bounds.width > 0 && bounds.height > 0; })));
  await gallery.screenshot({ path: join(artifacts, "icon-gallery.png"), fullPage: true });
  console.log("PASS: native cold reload then exactly one page refresh in requesting window, delayed draft flush and silent save-failure/conflict protection, closed-dialog refresh, no refresh on rejection/history, multiwindow status, keyboard focus, responsive dialog, persisted result and 50 icons; no model requests or chat runs.");
} finally {
  await browser.close(); await app.close(); http.closeAllConnections(); await new Promise<void>(r => http.close(() => r()));
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
