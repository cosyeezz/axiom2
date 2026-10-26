import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";
import { toolKey } from "../src/server/transcript.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-seamless-"));
const artifacts = process.env.AXIOM_SEAMLESS_ARTIFACTS ?? join(root, "artifacts");
mkdirSync(artifacts, { recursive: true }); mkdirSync(join(root, "project")); mkdirSync(join(root, "pi"));
const oldPi = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "project"), authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id, params: { title: "跨压缩过程无缝验收" } }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const manager = SessionManager.create(join(root, "project"), join(root, "native"));
  const assistant = (text: string, phase = "commentary", more: any = {}) => ({ role: "assistant", axiomRunId: "shared-run", timestamp: 1, stopReason: "toolUse",
    content: [{ type: "text", text, textSignature: JSON.stringify({ v: 1, id: crypto.randomUUID(), phase }) }], ...more }) as any;
  const compressions: string[] = [], calls: string[] = [];
  manager.appendMessage({ role: "user", content: "原始问题边界", timestamp: 1 });
  for (let i = 0; i < 4; i++) {
    const callId = `cross-read-${i}`;
    calls.push(manager.appendMessage(assistant("", "commentary", { content: [{ type: "thinking", thinking: `分段思考 ${i}` },
      { type: "toolCall", id: callId, name: "read", arguments: { path: `source-${i}.ts` } }] })));
    manager.appendMessage({ role: "toolResult", axiomRunId: "shared-run", axiomId: `tool-${toolKey("shared-run", callId)}`, toolCallId: callId,
      toolName: "read", content: [{ type: "text", text: `源范围工具正文 ${i}` }], isError: false, timestamp: 1 } as any);
    compressions.push(manager.appendCompaction(`完整摘要 ${i}，仅收起时可查看。`, null, 20000));
  }
  const liveThought = manager.appendMessage(assistant("", "commentary", { content: [{ type: "thinking", thinking: "当前尾部思考" }] }));
  const delivery = manager.appendMessage(assistant("完整最终交付", "final_answer", { stopReason: "stop" }));
  const liveRun = `run-${session.id}`;
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(session.id, manager.getSessionFile()!);
  const file = manager.getSessionFile()!, before = readFileSync(file, "utf8");
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" }); page.setDefaultTimeout(15000);
  await page.route("**/@vite/client", async route => { const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("async function handleMessage(payload) {", "async function handleMessage(payload) { return;") }); });
  const errors: string[] = [], reads: any[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("websocket", socket => socket.on("framesent", ({ payload }) => { const frame = JSON.parse(String(payload)); if (frame.op) reads.push(frame); }));
  await page.addInitScript(scope => sessionStorage.setItem("view", JSON.stringify(scope)), scope);
  await page.goto(app.origin);
  const settle = async () => { await page.waitForTimeout(250); await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))); };
  const top = async () => { await page.locator("#thread").dispatchEvent("wheel", { deltaY: -1 }); await page.locator("#thread").evaluate(node => { node.scrollTop = 0; }); await settle(); };
  const cards = page.locator(".history-card"), processes = page.locator("#messages .timeline-row > .tool-activity");
  await processes.waitFor(); await top();
  assert.equal(await cards.count(), 1, "only the collapsed oldest checkpoint has a card");
  assert.equal(await processes.count(), 1, "archive B/C/D and the live tail share one outer process");
  assert.equal(await processes.getAttribute("data-call-count"), "3");
  assert.equal(await processes.getAttribute("open"), null);
  assert.equal(reads.filter(frame => frame.op === "agent.history.read").length, 0, "closed unified process never reads archived bodies");
  await cards.getByRole("button", { name: "查看压缩信息", exact: true }).click();
  await page.getByText("完整摘要 0，仅收起时可查看。", { exact: true }).waitFor();
  await cards.getByRole("button", { name: "展开会话原文", exact: true }).click(); await settle(); await top();
  assert.equal(await cards.count(), 0, "expanded cards and summary controls leave the DOM entirely");
  assert.equal(await page.locator(".history-summary-disclosure,.history-range-row").count(), 0);
  assert.equal(await processes.count(), 1); assert.equal(await processes.getAttribute("data-call-count"), "4");
  assert.equal(await page.locator(".history-range-controls,.history-range-collapse").count(), 0, "expanded history has no floating collapse control");
  const processGroupIds = new Set(views.historyIndex(scope).segments.flatMap(segment => segment.groups.filter(group => group.activity).map(group => group.id)));
  const processReads = () => reads.filter(frame => frame.op === "agent.history.read" && processGroupIds.has(frame.params.groupId));
  assert.equal(processReads().length, 0);
  await processes.locator(":scope > summary").click();
  await processes.locator(".process-live").waitFor();
  assert.equal(processReads().length, 4, "opening hydrates each original source group, not entire segments");
  assert.equal(await processes.locator(".process-live").count(), 1, "gray process also coalesces across checkpoints");
  const inner = processes.locator(".process-live");
  await inner.locator(":scope > summary").click();
  assert.equal(await processes.locator(".thinking-block").count(), 5);
  assert.equal(await processes.locator(".tool-call").count(), 4);
  assert.equal(await processes.locator(".tool-detail").count(), 0, "tool detail stays lazy");
  await processes.locator(".tool-call").first().locator(":scope > summary").click();
  await processes.getByText("源范围工具正文 0", { exact: true }).waitFor();
  await page.screenshot({ path: join(artifacts, "1440-merged-open.png") });
  await processes.locator(":scope > summary").click(); await settle();

  // A streaming final must revoke delivery folding across every archive source.
  app.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,phase) VALUES(?,?,'running','{}',1,'requesting')").run(liveRun, session.id);
  views.messageChanged(scope, { id: delivery, role: "assistant", runId: "shared-run", text: "完整最终交付", phase: "final_answer", streaming: true, status: "running" });
  views.changed(scope); views.flush(scope);
  await page.waitForFunction(() => !!document.querySelector(".joined-process.process-live"));
  assert.equal(await page.locator(".timeline-row > .tool-activity:not(.process-live)").count(), 0);
  assert.equal(await processes.count(), 1, "pure tool/thinking sources retain one local disclosure");
  views.messageChanged(scope, { id: delivery, role: "assistant", runId: "shared-run", text: "完整最终交付", phase: "final_answer", streaming: false, status: "completed" });
  app.store.db.prepare("UPDATE runs SET status='completed' WHERE id=?").run(liveRun); views.changed(scope); views.flush(scope);
  await page.waitForFunction(() => !!document.querySelector(".joined-process:not(.process-live)"));
  assert.equal(await processes.getAttribute("data-status"), "completed");

  const choices = () => page.evaluate(scope => JSON.parse(sessionStorage.getItem(`axiom:history-ranges:${scope.workspaceId}:${scope.sessionId}`) ?? "{}"), scope);
  const opened = await choices(); assert.deepEqual(compressions.map(id => opened[id]), [true, true, true, true], "opened history stays open");
  assert.equal(await processes.count(), 1);
  for (const [width, height] of [[1440, 1000], [820, 900], [390, 844], [390, 480]]) {
    await page.setViewportSize({ width, height });
    const expand = page.getByRole("button", { name: "展开工作台", exact: true }); if (await expand.isVisible()) await expand.click();
    await top();
    await processes.hover(); await settle();
    assert.equal(await page.locator(".history-range-controls,.history-range-collapse,[data-collapse-segment]").count(), 0, `no collapse controls after hover at ${width}x${height}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `no overflow at ${width}x${height}`);
    await page.screenshot({ path: join(artifacts, `${width}-${height}-seamless.png`) });
  }
  await page.reload(); await processes.waitFor(); await settle();
  assert.deepEqual(await choices(), opened, "range choices survive reload");
  assert.equal(await processes.count(), 1); assert.equal(await processes.getAttribute("open"), null);
  assert.equal(readFileSync(file, "utf8"), before, "browsing never mutates native history");
  assert.ok(!reads.some(frame => ["prompt", "agent.fork"].includes(frame.op)));
  assert.deepEqual(errors, []);
  writeFileSync(join(artifacts, "report.json"), JSON.stringify({ scope, compressions, reads: reads.filter(frame => frame.op === "agent.history.read"), errors }, null, 2));
  console.log(`PASS archive/archive/live coalescing, both levels, masks, lazy reads, mixed live status, no collapse controls, responsive navigation, refresh; artifacts ${artifacts}`);
} finally {
  if (browser) for (const page of browser.contexts().flatMap(context => context.pages())) {
    await page.screenshot({ path: join(artifacts, "last-state.png") }).catch(() => {});
    writeFileSync(join(artifacts, "last-state.json"), JSON.stringify(await page.evaluate(() => ({ text: document.body.innerText, focused: document.activeElement?.outerHTML,
      rows: [...document.querySelectorAll<HTMLElement>("[data-timeline-key]")].map(node => ({ key: node.dataset.timelineKey, top: node.getBoundingClientRect().top, height: node.getBoundingClientRect().height })) })).catch(() => null), null, 2));
  }
  await browser?.close(); await app?.close();
  if (oldPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = oldPi;
  rmSync(root, { recursive: true, force: true });
}
