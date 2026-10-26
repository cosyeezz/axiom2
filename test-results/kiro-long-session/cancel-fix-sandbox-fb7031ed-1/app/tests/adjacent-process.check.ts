import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { ChatMessage } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-adjacent-process-"));
const artifacts = process.env.AXIOM_ADJACENT_ARTIFACTS ?? join(root, "artifacts");
mkdirSync(artifacts, { recursive: true }); mkdirSync(join(root, "project")); mkdirSync(join(root, "pi"));
const previousPi = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "project"), authorized: true } }) as Workspace;
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const session = () => app!.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scopeFor = (s: Session) => ({ workspaceId: workspace.id, sessionId: s.id });
  const publish = (s: Session, ...messages: ChatMessage[]) => { for (const m of messages) views.messageChanged(scopeFor(s), m); views.flush(scopeFor(s)); };
  const m = (id: string, more: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: "assistant", runId: "new-run", text: "", status: "completed", ...more });
  const request = (s: Session, status = "running") => {
    app!.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,phase) VALUES(?,?,?,'{}',1,'requesting') ON CONFLICT(id) DO UPDATE SET status=excluded.status").run(`run-${s.id}`, s.id, status);
    views.changed(scopeFor(s));
  };
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" }); page.setDefaultTimeout(15000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(app.origin);
  const openSession = async (s: Session) => { await page.evaluate(scope => sessionStorage.setItem("view", JSON.stringify(scope)), scopeFor(s)); await page.reload(); };
  const groups = page.locator("#messages .timeline-row > .tool-activity");

  // A prior run's completed process and a current run's thinking share one gray disclosure.
  const live = session();
  const before = m("before", { runId: "old-run", thinking: "前次检查", thinkingActive: true, streaming: true, status: "running" });
  const current = m("current", { thinking: "当前检查", thinkingActive: true, streaming: true, status: "running", runId: `run-${live.id}` });
  publish(live, m("user", { role: "user", text: "检查", runId: "old-run" }), before,
    m("old-tool", { runId: "old-run", calls: [{ id: "stale-tool", name: "read", input: '{}' }] }),
    m("tool-stale-tool", { role: "toolResult", toolCallId: "stale-tool", status: "running", toolStartedAt: Date.now() - 5000 }), current);
  request(live); await openSession(live);
  await groups.locator(':scope > summary .activity-title').getByText("正在思考", { exact: true }).waitFor();
  assert.equal(await groups.count(), 1); assert.equal(await groups.first().getAttribute("open"), null);
  assert.equal(await page.locator(".process-requesting").count(), 0);
  await groups.first().locator(":scope > summary").click();
  assert.equal(await groups.first().locator(".thinking-block").count(), 2);
  assert.equal(await groups.first().locator('.thinking-block[data-status="running"]').count(), 1, "stale thinking from an earlier run stays frozen");
  assert.equal(await groups.first().locator('.tool-duration').innerText(), "—", "an earlier run has no fabricated running duration");
  await page.waitForTimeout(350);
  assert.equal(await groups.first().locator('.tool-duration').innerText(), "—");
  publish(live, { ...current, thinkingActive: false, streaming: false, status: "completed" }); request(live, "completed");
  await groups.locator(':scope > summary .activity-title').getByText("执行完成", { exact: true }).waitFor();
  assert.equal(await groups.first().locator(':scope > summary .activity-status-completed').count(), 0, "local completion has no final-delivery checkmark");
  assert.equal(await groups.count(), 1);
  assert.equal(await groups.first().locator('.thinking-block[data-status="running"]').count(), 0, "old running deltas cannot keep a completed merged card active");
  await page.screenshot({ path: join(artifacts, "390-completed-merged.png") });

  // Error/cancellation attempts are retained inside the same disclosure during recovery.
  publish(live, m("error", { error: "保留失败详情", status: "failed" }), m("cancelled", { status: "cancelled" }),
    m("recover", { thinking: "恢复检查", status: "running", streaming: true, runId: `run-${live.id}` }));
  request(live);
  await groups.locator(':scope > summary .activity-title').getByText("正在思考", { exact: true }).waitFor();
  assert.equal(await groups.count(), 1);
  // New entries may change the disclosure key, but remain collapsed until explicitly opened.
  if (await groups.first().getAttribute("open") === null) await groups.first().locator(":scope > summary").click();
  await groups.first().getByText("保留失败详情", { exact: true }).waitFor();
  assert.equal(await groups.first().locator(".tool-activity").count(), 0);
  assert.equal(await groups.first().locator(".thinking-block").count(), 3);
  await page.screenshot({ path: join(artifacts, "390-recovery-merged.png") });

  // Cross-run final folding produces only one outer card; final thinking is inside, answer outside.
  const delivered = session();
  publish(delivered, m("user", { role: "user", text: "交付", runId: "old-run" }), before,
    m("new-thought", { thinking: "新运行检查" }), m("answer", { text: "最终交付内容", thinking: "交付核对", phase: "final_answer" }));
  await openSession(delivered); await groups.first().waitFor();
  assert.equal(await groups.count(), 1);
  assert.equal(await groups.first().locator(":scope > summary .activity-status-completed").count(), 1);
  await groups.first().locator(":scope > summary").click();
  assert.equal(await groups.first().locator(":scope > .activity-content > .tool-activity").count(), 1);
  assert.equal(await groups.first().getByText("最终交付内容", { exact: true }).count(), 0);
  await page.getByText("最终交付内容", { exact: true }).waitFor();
  await page.getByRole("button", { name: "复制回复的 Markdown 原文" }).waitFor({ state: "attached" });
  request(delivered); await page.locator(".process-requesting").waitFor();
  assert.equal(await groups.first().getAttribute("data-status"), "completed", "a later request must not reactivate delivered history");

  // A new run's request can precede its first message: reuse the existing tail
  // process instead of leaving a completed card beside another request indicator.
  const waiting = session();
  publish(waiting, { ...before, status: "completed", streaming: false, thinkingActive: false });
  request(waiting); await openSession(waiting);
  await groups.locator(':scope > summary .activity-title').getByText("请求中", { exact: true }).waitFor();
  assert.equal(await groups.count(), 1);
  assert.equal(await groups.first().getAttribute("data-status"), "running");
  assert.equal(await page.locator(".process-requesting").count(), 0);
  request(waiting, "completed");
  await groups.locator(':scope > summary .activity-title').getByText("执行完成", { exact: true }).waitFor();

  // Task slices do not settle a sibling tool that is actually still running.
  const parallel = session();
  const parallelRun = `run-${parallel.id}`;
  publish(parallel, m("mixed-tools", { runId: parallelRun, calls: [
    { id: "parallel-read", name: "read", input: '{}' },
    { id: "parallel-task", name: "append", input: JSON.stringify({ taskId: "fixture-task", text: "补充检查" }) },
  ] }), m("tool-parallel-read", { role: "toolResult", toolCallId: "parallel-read", status: "running", toolStartedAt: Date.now() - 5000 }));
  request(parallel);
  app.store.db.prepare("UPDATE runs SET phase='executing_tools' WHERE sessionId=?").run(parallel.id); views.changed(scopeFor(parallel));
  await openSession(parallel);
  await groups.locator(':scope > summary .activity-title').getByText("调用工具", { exact: true }).waitFor();
  assert.equal(await groups.first().getAttribute("data-status"), "running");
  await groups.first().locator(":scope > summary").click();
  const duration = groups.first().locator(".tool-duration");
  const elapsed = parseFloat(await duration.innerText());
  await page.waitForTimeout(350);
  assert.ok(parseFloat(await duration.innerText()) > elapsed, "the current run's active tool retains its live clock across a task slice");

  // Native compaction projection merges two adjacent run-owned outer cards, preserving lazy inner details.
  const archived = session();
  const manager = SessionManager.create(join(root, "project"), join(root, "native"));
  const assistant = (runId: string, content: any[], stopReason = "toolUse") => ({ role: "assistant", axiomRunId: runId, content, stopReason, timestamp: 1 }) as any;
  manager.appendMessage({ role: "user", content: "归档检查", timestamp: 1 });
  manager.appendMessage(assistant("old", [{ type: "thinking", thinking: "旧运行记录" }]));
  manager.appendMessage(assistant("new", [{ type: "thinking", thinking: "新运行记录" }]));
  manager.appendMessage(assistant("new", [{ type: "text", text: "归档前确认最终交付" }], "stop"));
  const compaction = manager.appendCompaction("完整交接摘要", null, 20000);
  manager.appendMessage({ role: "user", content: "当前问题", timestamp: 2 });
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(archived.id, manager.getSessionFile()!);
  await openSession(archived);
  const outer = page.locator(".archived-process");
  await outer.waitFor(); assert.equal(await outer.count(), 1);
  assert.equal(views.historyIndex(scopeFor(archived)).segments.find(s => s.id === compaction)!.groups.filter(g => g.activity).length, 1);
  assert.equal(await outer.locator(".thinking-block").count(), 0);
  await outer.locator(":scope > summary").click();
  const inner = outer.locator(":scope > .activity-content .tool-activity");
  await inner.waitFor(); assert.equal(await inner.count(), 1);
  assert.equal(await inner.getAttribute("open"), null);
  await inner.locator(":scope > summary").click();
  assert.equal(await inner.locator(".thinking-block").count(), 2);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(artifacts, `${width}-archive-merged.png`) });
  }
  // A commentary-only native fragment can be archived before the eventual
  // delivery. Exercise a long virtualized conversation, not just group counts.
  const narrationArchive = session();
  const narrationManager = SessionManager.create(join(root, "project"), join(root, "narration-native"));
  const nativeText = (phase: string, text: string) => [{ type: "text", text, textSignature: JSON.stringify({ v: 1, id: crypto.randomUUID(), phase }) }];
  narrationManager.appendMessage(assistant("split-run", nativeText("commentary", "跨压缩点的独立过程说明"), "stop"));
  const commentarySegment = narrationManager.appendCompaction("完整交接摘要：过程尚未交付", null, 20000);
  narrationManager.appendMessage(assistant("split-run", nativeText("final_answer", "跨段最终交付必须保持外置"), "stop"));
  for (let i = 0; i < 45; i++) {
    narrationManager.appendMessage({ role: "user", content: `长会话后续问题 ${i}`, timestamp: i + 2 });
    narrationManager.appendMessage(assistant(`filler-${i}`, nativeText("final_answer", `后续交付 ${i}。${"长会话滚动验证。".repeat(12)}`), "stop"));
  }
  narrationManager.appendCompaction("完整交接摘要：后续历史", null, 30000);
  narrationManager.appendMessage({ role: "user", content: "当前问题", timestamp: 100 });
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(narrationArchive.id, narrationManager.getSessionFile()!);
  await openSession(narrationArchive);
  const narrationIndex = views.historyIndex(scopeFor(narrationArchive));
  const narrationGroup = narrationIndex.segments.find(s => s.id === commentarySegment)!.groups[0];
  assert.equal(narrationGroup.folded, true); assert.equal(narrationGroup.process?.inline, false);
  const narrationCard = page.locator(`[data-timeline-key="archive:${commentarySegment}:${narrationGroup.id}"] > .archived-process`);
  const scrollHistory = async (bottom: boolean) => {
    await page.locator("#thread").evaluate((node, bottom) => {
      // Focus intentionally pins its row for accessibility. Release the clicked
      // summary before asserting actual virtual recycling, not focus retention.
      (document.activeElement as HTMLElement | null)?.blur();
      getSelection()?.removeAllRanges();
      node.dispatchEvent(new WheelEvent("wheel", { deltaY: bottom ? 100000 : -100000, bubbles: true }));
      node.scrollTop = bottom ? node.scrollHeight : 0;
    }, bottom);
  };
  await scrollHistory(false); await narrationCard.waitFor();
  assert.equal(await narrationCard.getAttribute("open"), null);
  assert.equal(await page.getByText("跨压缩点的独立过程说明", { exact: true }).count(), 0, "collapsed process stays lazy");
  await narrationCard.locator(":scope > summary").click();
  await narrationCard.getByText("跨压缩点的独立过程说明", { exact: true }).waitFor();
  await page.getByText("跨段最终交付必须保持外置", { exact: true }).waitFor();
  assert.equal(await narrationCard.getByText("跨段最终交付必须保持外置", { exact: true }).count(), 0);
  await narrationCard.locator(":scope > summary").click();
  await scrollHistory(true); await narrationCard.waitFor({ state: "detached" });
  await scrollHistory(false); await narrationCard.waitFor();
  assert.equal(await narrationCard.getAttribute("open"), null, "scrolling back does not open a closed archive");
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await scrollHistory(false);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(artifacts, `${width}-commentary-archive-closed.png`) });
  }
  await narrationCard.locator(":scope > summary").click();
  await scrollHistory(true); await narrationCard.waitFor({ state: "detached" });
  await scrollHistory(false); await narrationCard.waitFor();
  assert.notEqual(await narrationCard.getAttribute("open"), null, "explicit user expansion survives recycling");
  await narrationCard.getByText("跨压缩点的独立过程说明", { exact: true }).waitFor();
  await page.screenshot({ path: join(artifacts, "1440-commentary-archive-manual-open.png") });
  assert.deepEqual(errors, []);
  console.log(`PASS adjacent gray/green, cross-run completion, recovery details, dynamic requesting, final outside, lazy archive hierarchy, commentary-only cross-compaction long-history scroll; artifacts ${artifacts}`);
} finally {
  await browser?.close(); await app?.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
