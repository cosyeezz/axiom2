import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-sidebar-count-"));
const app = await startServer({ root: join(root, "data"), port: 0 });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const cwd = join(root, "project"); mkdirSync(cwd);
  const run = (op: string, params = {}, workspaceId?: string, sessionId?: string) => app.store.execute({ op, params, workspaceId, sessionId, requestId: crypto.randomUUID() });
  const workspace = run("workspace.open", { path: cwd, authorized: true }) as Workspace;
  const session = run("session.create", {}, workspace.id) as Session;
  run("session.rename", { title: "消息统计" }, workspace.id, session.id);
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const manager = SessionManager.create(cwd, join(root, "native"));
  manager.appendMessage({ role: "user", content: "question", timestamp: 1 });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "answer" }], stopReason: "stop", timestamp: 2 } as any);
  manager.appendCompaction("summary", null, 1000);
  manager.appendMessage({ role: "user", content: "follow up", timestamp: 3 });
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(session.id, manager.getSessionFile()!);
  app.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,phase) VALUES(?,?,'running',?,?,'requesting')")
    .run("fixture-run", session.id, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }), Date.now());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(view => sessionStorage.setItem("view", JSON.stringify(view)), scope);
  await page.goto(app.origin);
  const row = page.locator(`[data-session-id="${session.id}"]`);
  await row.locator(".session-message-count").filter({ hasText: "3 条消息" }).waitFor();
  assert.match(await row.locator("small").first().innerText(), /\d{2}:\d{2}\s*· 3 条消息\s*· 请求中/);
  assert.deepEqual(await row.locator("small").first().locator(":scope > span").allTextContents().then(parts => parts.map(part => part.trim())), [
    await row.locator(".session-detail").first().textContent(), "· 3 条消息", "· 请求中",
  ]);
  assert.match(await row.locator(".session-detail").first().innerText(), /\d{2}:\d{2}/);
  const views = (app.agents as unknown as { views: AgentViews }).views;
  views.messageChanged(scope, { id: "live", role: "assistant", text: "live reply", streaming: true });
  views.flush(scope);
  await row.locator(".session-message-count").filter({ hasText: "4 条消息" }).waitFor();
  await row.hover();
  assert.equal(await row.locator(".session-message-count").evaluate(node => node.scrollWidth <= node.clientWidth), true);
  await page.screenshot({ path: "/tmp/axiom-session-count-desktop.png" });
  await page.reload();
  await row.locator(".session-message-count").filter({ hasText: "4 条消息" }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#toggle-history").click();
  await row.locator(".session-message-count").waitFor({ state: "visible" });
  assert.match(await row.locator("small").first().innerText(), /\d{2}:\d{2}\s*· 4 条消息\s*· 请求中/);
  assert.equal(await row.locator(".session-message-count").evaluate(node => node.scrollWidth <= node.clientWidth), true);
  await page.screenshot({ path: "/tmp/axiom-session-count-mobile.png" });
  assert.deepEqual(errors, []);
  console.log("sidebar count: compact phases, archived+live counts, reload, desktop/mobile passed");
} finally { await browser.close(); await app.close(); rmSync(root, { recursive: true, force: true }); }
