import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import { runOriginLabels, type ChatMessage, type RunOrigin } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-activity-origin-"));
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS || "test-results/activity-origin-display");
for (const path of ["project", "pi"]) mkdirSync(join(root, path));
mkdirSync(artifacts, { recursive: true });
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: !process.env.AXIOM_TEST_PRODUCTION });
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "project"), authorized: true } }) as Workspace;
  const create = () => app!.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const live = create(), archived = create();
  const scope = { workspaceId: workspace.id, sessionId: live.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const origins = Object.keys(runOriginLabels) as RunOrigin[];
  app.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,origin) VALUES('live-run',?,'running','{}',1,'manual_resume')").run(live.id);
  const publish = (message: ChatMessage) => { views.messageChanged(scope, message); views.flush(scope); };
  publish({ id: "user", role: "user", text: "检查执行状态" });
  const thought: ChatMessage = { id: "thought", role: "assistant", runId: "live-run", text: "", thinking: "正在核对状态。", thinkingActive: true, streaming: true, status: "running" };
  publish(thought);

  const manager = SessionManager.create(join(root, "project"), join(root, "native"));
  for (const [i, origin] of origins.entries()) {
    const runId = `archive-${origin}`, callId = `call-${i}`;
    app.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,origin) VALUES(?,?,'completed','{}',?,?)").run(runId, archived.id, i + 1, origin);
    manager.appendMessage({ role: "user", content: `历史检查 ${i}`, timestamp: 1 });
    manager.appendMessage({ role: "assistant", axiomRunId: runId, content: [{ type: "thinking", thinking: "核对历史状态。" }, { type: "toolCall", id: callId, name: "read", arguments: { path: "fixture.txt" } }], stopReason: "toolUse", timestamp: 1 } as any);
    manager.appendMessage({ role: "toolResult", toolCallId: callId, toolName: "read", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 1 });
    manager.appendMessage({ role: "assistant", axiomRunId: runId, content: [{ type: "text", text: `历史检查 ${i} 完成。`, textSignature: JSON.stringify({ v: 1, id: `final-${i}`, phase: "final_answer" }) }], stopReason: "stop", timestamp: 1 } as any);
  }
  const compaction = manager.appendCompaction("历史状态检查摘要", null, 2000);
  manager.appendMessage({ role: "user", content: "当前问题", timestamp: 1 });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "当前回复。" }], stopReason: "stop", timestamp: 1 } as any);
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(archived.id, manager.getSessionFile()!);
  const archivedScope = { workspaceId: workspace.id, sessionId: archived.id };
  const summaries = views.historyIndex(archivedScope).segments.find(segment => segment.id === compaction)!.groups;
  assert.deepEqual([...new Set(summaries.flatMap(group => group.process?.origins ?? []))].sort(), [...origins].sort(), "fixture contains trusted archived source metadata");

  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { if (!sessionStorage.getItem("view")) sessionStorage.setItem("view", JSON.stringify(value)); }, scope);
  await page.goto(app.origin);
  const group = page.locator("#messages .tool-activity").first();
  const title = group.locator(":scope > summary .activity-title");
  const noSources = async () => {
    assert.equal(await page.locator("#messages .process-origin, #messages [aria-label^='触发来源：']").count(), 0);
    const headers = await page.locator("#messages .tool-activity > summary").allTextContents();
    for (const label of Object.values(runOriginLabels)) assert.ok(headers.every(text => !text.includes(label)), `no source label: ${label}`);
  };
  for (const origin of origins) {
    app.store.db.prepare("UPDATE runs SET origin=? WHERE id='live-run'").run(origin);
    publish(thought);
    await title.filter({ hasText: "正在思考" }).waitFor();
    assert.equal(views.message(scope, thought.id)!.runOrigin, origin, "source fact is preserved, not blanked to hide UI");
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await noSources();
      assert.equal(await title.locator(".process-ellipsis").count(), 1, "normal progress indicator remains");
    }
    publish({ ...thought, thinking: undefined, thinkingActive: false, calls: [{ id: "live-call", name: "read", input: '{"path":"fixture.txt"}' }] });
    await title.filter({ hasText: "调用工具" }).waitFor();
    await noSources();
  }
  await page.screenshot({ path: join(artifacts, "mobile-live.png") });
  await page.reload();
  await title.filter({ hasText: "调用工具" }).waitFor();
  await noSources();

  await page.evaluate(({ scope, compaction }) => {
    sessionStorage.setItem("view", JSON.stringify(scope));
    // Recent ranges default to expanded; explicitly start with this range closed.
    sessionStorage.setItem(`axiom:history-ranges:${scope.workspaceId}:${scope.sessionId}`, JSON.stringify({ [compaction]: false }));
  }, { scope: archivedScope, compaction });
  await page.reload();
  await page.getByText("当前回复。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "展开会话原文", exact: true }).click();
  await page.locator("#messages .archived-process").first().waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await noSources();
    assert.ok(await page.locator("#messages .archived-process .activity-title").count() > 0, "archived status titles remain");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no horizontal overflow");
    await page.screenshot({ path: join(artifacts, `${width}-archived.png`) });
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: all four origins hidden in live thinking/tools, reload and archived summaries; source facts and normal desktop/mobile progress retained. Artifacts: ${artifacts}`);
} finally {
  await browser?.close();
  await app?.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
  else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
