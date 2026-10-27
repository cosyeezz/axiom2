import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import { editableMessage, rewriteBranch } from "../src/server/session-rewrite.js";
import { chatMessage } from "../src/server/transcript.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-continuation-ui-"));
const artifacts = process.env.AXIOM_CONTINUATION_ARTIFACTS ?? mkdtempSync(join(tmpdir(), "axiom-continuation-evidence-"));
mkdirSync(artifacts, { recursive: true }); mkdirSync(join(root, "project")); mkdirSync(join(root, "pi"));
const previousPi = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const assistant = (text: string, phase = "commentary", run = "old", more: object = {}) => ({ role: "assistant", axiomRunId: run,
  content: [{ type: "text", text, textSignature: JSON.stringify({ v: 1, id: crypto.randomUUID(), phase }) }], stopReason: "stop", timestamp: 1, ...more }) as any;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "project"), authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const manager = SessionManager.create(join(root, "project"), join(root, "native"));
  manager.appendMessage({ role: "user", content: "修复名称和刷新", timestamp: 1 });
  manager.appendMessage(assistant("追加前的过程说明必须收拢", "commentary", "old", { content: [
    { type: "thinking", thinking: "追加前的检查" }, { type: "text", text: "追加前的过程说明必须收拢" },
    { type: "toolCall", id: "delegate", name: "delegate", arguments: { tasks: [{ title: "核对名称元数据", task: "检查" }] } },
    { type: "toolCall", id: "read", name: "read", arguments: { path: "cache.ts" } },
  ], stopReason: "toolUse" }));
  manager.appendCompaction("第一次压缩：尚未交付", null, 20000);
  manager.appendCustomMessageEntry("axiom-append", "追加懒加载", true, { axiomInput: "append" });
  rewriteBranch(manager, editableMessage(manager, "input-append"), "first-rewrite", []);
  manager.appendMessage({ role: "user", content: "继续", timestamp: 2, axiomId: "replacement", axiomInputIds: ["first-rewrite"] } as any);
  rewriteBranch(manager, editableMessage(manager, "replacement"), "second-rewrite", []);
  manager.appendMessage({ role: "user", content: "追加懒加载", timestamp: 3, axiomId: "rewritten", axiomInputIds: ["second-rewrite"] } as any);
  manager.appendMessage(assistant("追加后的实施说明", "commentary", "new"));
  manager.appendCompaction("第二次压缩：尚未交付", null, 20000);
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(session.id, manager.getSessionFile()!);
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" }); page.setDefaultTimeout(15000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(app.origin);
  await page.evaluate(scope => sessionStorage.setItem("view", JSON.stringify(scope)), scope); await page.reload();
  await page.getByText("追加前的过程说明必须收拢", { exact: true }).waitFor();
  await page.locator('.delegation-card').waitFor();
  await page.getByText("追加懒加载", { exact: true }).waitFor();
  assert.equal(await page.locator('.timeline-row > details > summary .activity-status-completed').count(), 0, "two compactions do not prove delivery");
  await page.screenshot({ path: join(artifacts, "390-undelivered.png") });

  // Terminal delta arrives before native persistence: old archives must settle now.
  const final = assistant("完整交付正文始终外置", "final_answer", "new", { axiomId: "final" });
  views.messageChanged(scope, chatMessage(final, "final")!); views.flush(scope);
  const cards = page.locator('.timeline-row > details.tool-activity');
  await page.waitForFunction(() => document.querySelectorAll('.timeline-row > details > summary .activity-status-completed').length === 2);
  assert.equal(await cards.count(), 2, "one outer card per side of the visible user input");
  assert.equal(await page.getByText("追加前的过程说明必须收拢", { exact: true }).count(), 0);
  assert.equal(await page.locator('.delegation-card').count(), 0);
  await page.getByText("追加懒加载", { exact: true }).waitFor();
  await page.getByText("完整交付正文始终外置", { exact: true }).waitFor();
  assert.equal(await cards.getByText("完整交付正文始终外置", { exact: true }).count(), 0);
  assert.equal(await cards.getByText("追加懒加载", { exact: true }).count(), 0);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(artifacts, `${width}-delivered-closed.png`) });
  }
  await cards.first().locator(':scope > summary').click();
  await cards.first().getByText("追加前的过程说明必须收拢", { exact: true }).waitFor();
  await cards.first().locator('.delegation-card').waitFor();
  assert.ok(await cards.first().locator('.activity-content .tool-activity').count() > 0, "original inner process hierarchy survives");
  await cards.first().locator(':scope > summary').click();
  manager.appendMessage(final); views.refresh(scope); await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.timeline-row > details > summary .activity-status-completed').length === 2);
  assert.equal(await cards.count(), 2);
  assert.equal(await page.getByText("追加前的过程说明必须收拢", { exact: true }).count(), 0, "reload keeps the archive folded");
  await page.getByText("完整交付正文始终外置", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(`PASS: append + twice rewrite + cross-run/two compactions; no early folding; terminal delta folds both sides, user/final outside, task and inner hierarchy, reload; 390/1440px. Artifacts: ${artifacts}`);
} finally {
  await browser?.close(); await app?.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
