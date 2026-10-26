// Isolated UI fixture: exercises real subscriptions and grouping, without calling a model.
// Run: npm exec tsx tests/tool-activity.check.ts
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Locator } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import { type ChatMessage } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

async function toolColor(row: Locator, name: string) {
  // Measure the default appearance: expanding a group can put a row under the cursor.
  await row.page().mouse.move(0, 0);
  assert.equal(await row.getAttribute("data-tool"), name);
  assert.equal(await row.locator(".tool-name").innerText(), name);
  const labelColor = await row.locator(".tool-name").evaluate((node) => getComputedStyle(node).color);
  const iconColor = await row.locator(".tool-icon").evaluate((node) => getComputedStyle(node).color);
  assert.equal(labelColor, iconColor, `${name}: label and icon share their computed color`);
  assert.equal(labelColor, await row.evaluate(node => getComputedStyle(node).color), `${name}: label and icon match the path/command foreground`);
  return labelColor;
}

const root = mkdtempSync(join(tmpdir(), "axiom-tool-activity-"));
const artifacts = resolve("test-results/tool-activity");
mkdirSync(artifacts, { recursive: true });
mkdirSync(join(root, "workspace"));
mkdirSync(join(root, "pi"));
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "workspace"), authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const call = (id: string, name: string, input: unknown) => ({ id, name, input: JSON.stringify(input, null, 2) });
  const messages: ChatMessage[] = [
    { id: "user", role: "user", text: "检查工具调用展示" },
    { id: "a1", role: "assistant", text: "先检查文件。", calls: [call("read", "read", { path: "F:/项目/src/very-long-folder/".repeat(10) + "main.ts", offset: 12, limit: 40 })] },
    { id: "tool-read", role: "toolResult", toolCallId: "read", text: "export const ready = true;\n".repeat(1000) + "FULL_OUTPUT_END", status: "completed", durationMs: 123 },
    { id: "a2", role: "assistant", text: "", calls: [call("edit", "edit", { path: "src/main.ts", edits: [{ oldText: "false", newText: "true" }] }), call("stop", "bash", { command: "npm run check" })] },
    { id: "tool-edit", role: "toolResult", toolCallId: "edit", text: "starting\nError: target text not found", status: "failed", durationMs: 1500 },
    { id: "tool-stop", role: "toolResult", toolCallId: "stop", text: "", status: "cancelled" },
    { id: "a3", role: "assistant", text: "", calls: [call("shell", "powershell", { command: "npm test" }), call("unknown", "custom_tool", { query: "<img src=x onerror=alert(1)>" })] },
    { id: "tool-shell", role: "toolResult", toolCallId: "shell", text: "Running tests…", status: "running" },
    { id: "answer", role: "assistant", text: "## 检查结论\n\n需要核对修改目标。", status: "completed" },
  ];
  for (const message of messages) views.messageChanged(scope, message);
  views.flush(scope);
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  // Sessions are never paged: an opened call reads each hidden field once and in full.
  const waitFull = async (container: Locator) => {
    await page.waitForFunction(() => !document.querySelector('.tool-truncated[role="status"]'));
    assert.equal(await container.getByRole("button", { name: /^继续加载/ }).count(), 0, "no load-more control");
  };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((value) => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  let detailReads = 0;
  page.on("websocket", socket => socket.on("framesent", event => {
    const frame = JSON.parse(String(event.payload));
    if (frame.op === "message.part") detailReads++;
  }));
  await page.goto(app.origin);
  let group = page.locator(".tool-activity");
  await page.waitForFunction(() => document.querySelector(".tool-activity > summary")?.textContent?.includes("5 项"));
  assert.equal(await group.count(), 1, "consecutive calls share one process block");
  assert.equal(await group.getAttribute("open"), null);
  const header = await group.locator(":scope > summary").innerText();
  for (const value of ["custom_tool", "<img src=x onerror=alert(1)>"]) assert.ok(header.includes(value), value);
  assert.equal(await group.locator(".activity-counts, .activity-hint").count(), 0);
  assert.equal(await group.getAttribute("data-status"), "running");
  assert.ok(!header.includes("target text not found"), "older failures do not replace the latest call");
  assert.equal(await group.locator(".activity-current:not(.activity-current-out) use").getAttribute("href"), "#i-tool-tool");
  let current = group.locator(".activity-current:not(.activity-current-out)");
  const unknownColor = await toolColor(current, "custom_tool");
  assert.equal(await group.locator(".execution-pulse").count(), 0, "tool rows only show duration, without a status indicator");
  assert.equal(detailReads, 0, "closed process sends no detail reads");
  assert.equal(await group.locator("pre").count(), 0, "closed tools do not mount heavy output");
  assert.equal(await page.locator('.message-actions:has(button[aria-label="复制回复的 Markdown 原文"])').count(), 0, "unconfirmed assistant bodies do not expose final-delivery copy controls");
  assert.ok(await page.getByRole("heading", { name: "检查结论" }).isVisible());
  await group.locator(":scope > summary").focus();
  await page.keyboard.press("Enter");
  await page.locator(".tool-header").first().waitFor({ state: "visible" });
  assert.equal(await group.locator(".activity-ticker").count(), 0, "expanded group does not duplicate the latest summary");
  assert.equal(await group.locator(".tool-call > summary").count(), 5, "each tool has its own disclosure");
  assert.equal(detailReads, 0, "opening process does not fetch tool bodies");
  assert.equal(await group.locator(".tool-detail").count(), 0, "opening the group only exposes the call list");
  const colors = new Map<string, string>();
  for (const name of ["read", "bash", "custom_tool"]) {
    colors.set(name, await toolColor(group.locator(`.tool-heading[data-tool="${name}"]`).first(), name));
  }
  const failedHeader = group.locator('.tool-call[data-status="failed"] > summary');
  const failedColor = await toolColor(failedHeader.locator('.tool-heading'), "edit");
  assert.notEqual(failedColor, unknownColor, "failed rows differ from normal rows");
  assert.ok(await failedHeader.evaluate(node => [node, ...node.querySelectorAll('*')].every(child => getComputedStyle(child).color === getComputedStyle(node).color)), "every part of the failed row is red");
  colors.set("edit", unknownColor);
  const shellHeadings = group.locator('.tool-heading[data-tool="bash"]');
  assert.equal(await shellHeadings.count(), 2, "powershell is displayed as bash");
  assert.equal(await toolColor(shellHeadings.nth(1), "bash"), colors.get("bash"), "powershell display alias uses bash color");
  assert.equal(new Set(colors.values()).size, 1, "all tools share the same foreground");
  assert.equal(colors.get("custom_tool"), unknownColor, "collapsed and expanded unknown-tool colors match");
  assert.ok((await page.locator(".tool-call").first().innerText()).includes("L12–51"));
  assert.ok((await page.locator(".tool-call").first().innerText()).includes("0.1s"));
  assert.deepEqual(await group.locator(".tool-duration").allTextContents(), ["0.1s", "1.5s", "—", "—", "—"], "right side only shows recorded duration");
  assert.equal(await group.locator(".tool-header").first().evaluate(node => getComputedStyle(node, "::after").content), "none", "collapsed rows have no plus sign");
  await page.locator(".tool-call > summary").first().focus();
  await page.keyboard.press("Enter");
  assert.equal(await group.locator(".tool-detail").count(), 1, "only the selected call loads records");
  assert.equal(await group.locator(".tool-header").first().evaluate(node => getComputedStyle(node, "::after").content), "none", "expanded rows have no minus sign");
  await page.waitForFunction(() => document.querySelector(".tool-detail")?.textContent?.includes("FULL_OUTPUT_END"));
  await waitFull(group);
  assert.equal(detailReads, 1, "one full read, no follow-up pages");
  assert.equal(await group.locator(".tool-truncated").count(), 0, "full output finished loading");
  assert.ok((await group.locator('.tool-call[data-status="failed"]').innerText()).includes("target text not found"));
  await group.locator(":scope > summary").click();
  assert.equal(await group.locator("pre").count(), 0, "collapsing the process releases expanded detail DOM");
  await group.locator(":scope > summary").click();
  assert.equal(await group.locator(".tool-detail, .tool-call[open]").count(), 0, "reopening the group resets child disclosures");
  await page.locator(".tool-call > summary").first().click();
  await page.waitForFunction(() => document.querySelector(".tool-detail")?.textContent?.includes("FULL_OUTPUT_END"));
  await waitFull(group);
  assert.equal(await group.locator("img").count(), 0);
  await group.locator('.tool-call[data-status="running"] > summary').click();
  // Status-only updates retain open disclosures and refresh visible output.
  views.messageChanged(scope, { id: "tool-shell", role: "toolResult", text: "All tests passed", status: "completed" });
  views.flush(scope);
  await page.waitForFunction(() => document.querySelector('.tool-call[data-status="running"]') === null);
  assert.equal(await group.getAttribute("data-status"), "unknown", "missing tool results stay unknown, despite older failures");
  views.messageChanged(scope, { id: "tool-unknown", role: "toolResult", text: "Done", status: "completed" });
  views.flush(scope);
  await page.waitForFunction(() => document.querySelector('.tool-activity')?.getAttribute('data-status') === 'completed');
  assert.equal(await group.locator('.tool-call[data-status="failed"]').count(), 1, "local tool failure remains visible without failing the process");
  assert.equal(await group.locator('.tool-call[data-status="cancelled"]').count(), 1, "local tool cancellation does not stop the process");
  assert.equal(await group.locator('.activity-status').getAttribute('aria-label'), '已完成');
  assert.equal(await group.getAttribute("open"), "");
  assert.ok((await group.innerText()).includes("All tests passed"));
  for (const [width, height] of [[360, 800], [390, 844], [600, 960], [820, 1180], [1024, 768], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `page overflow ${width}`);
    assert.ok(await group.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), `group overflow ${width}`);
    await group.screenshot({ path: join(artifacts, `expanded-${width}.png`) });
    await group.locator(":scope > summary").click();
    const geometry = await group.evaluate(node => {
      const title = node.querySelector(".activity-title")!.getBoundingClientRect();
      const ticker = node.querySelector(".activity-ticker")!.getBoundingClientRect();
      return { titleBottom: title.bottom, tickerTop: ticker.top, fits: node.scrollWidth <= node.clientWidth + 1 };
    });
    assert.ok(geometry.tickerTop >= geometry.titleBottom, `two-line collapsed summary ${width}`);
    assert.ok(geometry.fits, `collapsed overflow ${width}`);
    assert.ok((await current.innerText()).includes("custom_tool"), "late results do not rewind latest activity");
    await group.screenshot({ path: join(artifacts, `collapsed-${width}.png`) });
    await group.locator(":scope > summary").click();
  }
  await group.locator(":scope > summary").click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: join(artifacts, "collapsed-1440.png") });
  // A new call starts after the existing body without reopening the prior group.
  views.messageChanged(scope, { id: "answer", role: "assistant", text: "继续核查。", calls: [call("next", "read", { path: "README.md" })] });
  views.flush(scope);
  await page.waitForFunction(() => document.querySelectorAll(".tool-activity").length === 2);
  assert.equal(await page.locator(".tool-activity").count(), 2);
  group = page.locator(".tool-activity").nth(1);
  current = group.locator(".activity-current:not(.activity-current-out)");
  assert.equal(await group.getAttribute("open"), null);
  await current.filter({ hasText: "README.md" }).waitFor();
  assert.equal(await toolColor(current, "read"), colors.get("read"), "collapsed read matches expanded read");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForTimeout(350);
  views.messageChanged(scope, { id: "answer", role: "assistant", text: "继续核查。", calls: [call("next", "read", { path: "README.md" }), call("newest", "edit", { path: "latest.ts", edits: [] })] });
  views.flush(scope);
  await page.waitForFunction(() => document.querySelector(".activity-current-in")?.textContent?.includes("latest.ts"), null, { polling: "raf" });
  assert.equal(await group.locator(".activity-current-in").evaluate((node) => getComputedStyle(node).animationName), "activity-roll-in");
  assert.equal(await group.locator(".activity-current-out").getAttribute("aria-hidden"), "true");
  assert.equal(await group.locator(".activity-ticker").evaluate((node) => getComputedStyle(node).overflow), "hidden");
  await page.waitForTimeout(350);
  assert.equal(await group.locator(".activity-current").count(), 1);
  assert.equal(await toolColor(current, "edit"), colors.get("edit"), "collapsed edit matches expanded edit");
  await page.screenshot({ path: join(artifacts, "running-latest-1440.png") });
  views.messageChanged(scope, { id: "tool-newest", role: "toolResult", text: "Error: target not found", status: "failed" });
  views.flush(scope);
  await page.waitForFunction(() => document.querySelectorAll('.activity-current:not(.activity-current-out)')[1]?.getAttribute('data-status') === 'failed');
  assert.equal(await toolColor(current, "edit"), failedColor, "failed collapsed summary matches the failed row");
  assert.ok(await current.evaluate(node => [node, ...node.querySelectorAll('*')].every(child => getComputedStyle(child).color === getComputedStyle(node).color)));
  await group.screenshot({ path: join(artifacts, "failed-latest-1440.png") });
  views.messageChanged(scope, { id: "tool-newest", role: "toolResult", text: "Done", status: "completed" });
  views.flush(scope);
  await page.waitForFunction(() => document.querySelectorAll('.activity-current:not(.activity-current-out)')[1]?.getAttribute('data-status') === 'completed');
  assert.equal(await toolColor(current, "edit"), unknownColor, "status changes clear failure coloring");
  await page.reload();
  await group.locator('.activity-title').filter({ hasText: '2 项' }).waitFor();
  assert.equal(await page.locator('.tool-activity').count(), 2);
  assert.ok((await group.locator(".activity-current:not(.activity-current-out)").innerText()).includes("latest.ts"));
  // Extend only after the original count/reload/responsive checks, preserving that fixture.
  // Shared icons and distinct names all use the same foreground.
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Task tools have their own cards and are covered by delegation-order.check.ts.
  const additionalTools = ["write", "pwsh", "grep", "find", "ls", "web_search", "source_check", "fetch_content", "get_search_content"];
  views.messageChanged(scope, { id: "answer", role: "assistant", text: "继续核查。", calls: [
    call("next", "read", { path: "README.md" }), call("newest", "edit", { path: "latest.ts", edits: [] }),
    ...additionalTools.map((name) => call(`color-${name}`, `functions.${name}`, {})),
  ] });
  views.flush(scope);
  await current.locator('.tool-name').filter({ hasText: /^get_search_content$/ }).waitFor();
  const resultColor = await toolColor(current, "get_search_content");
  assert.equal(await group.getAttribute("open"), null);
  await group.locator(":scope > summary").click();
  for (const name of additionalTools) {
    colors.set(name, await toolColor(group.locator(`.tool-heading[data-tool="${name}"]`), name));
  }
  assert.equal(colors.get("get_search_content"), resultColor, "collapsed and expanded result colors match");
  const knownColors = [...colors].filter(([name]) => name !== "custom_tool").map(([, color]) => color);
  assert.equal(new Set(knownColors).size, 1, "all covered tools use the same foreground regardless of shared icons");
  // Long input/output is fetched only after opening the individual call.
  views.messageChanged(scope, { id: "long-input", role: "assistant", text: "", calls: [call("long-write", "write", { path: "large.txt", content: "x".repeat(17000) + "FULL_INPUT_END" })] });
  views.messageChanged(scope, { id: "tool-long-write", role: "toolResult", text: "first\n".repeat(4000), status: "running" });
  views.flush(scope);
  const longCall = group.locator('.tool-call[aria-label="write"]').last();
  await longCall.locator(":scope > summary").waitFor();
  assert.equal(await longCall.locator(".tool-detail").count(), 0, "new calls arrive collapsed in an open group");
  await longCall.locator(":scope > summary").click();
  await longCall.getByText(/FULL_INPUT_END/).waitFor();
  await waitFull(longCall);
  views.messageChanged(scope, { id: "tool-long-write", role: "toolResult", text: "first\n".repeat(4000) + "FINAL_OUTPUT_END", status: "completed" });
  views.flush(scope);
  await longCall.getByText(/FINAL_OUTPUT_END/).waitFor();
  await waitFull(longCall);
  assert.equal(await group.getAttribute("open"), "", "streaming completion keeps the group open");
  assert.equal(await longCall.locator(".tool-truncated").count(), 0);
  // A single-call example verifies the duplication shown in the reported screenshot.
  views.messageChanged(scope, { id: "single-boundary", role: "user", text: "查看单次工具调用" });
  views.messageChanged(scope, { id: "single", role: "assistant", text: "", calls: [call("single-shell", "powershell", { command: "rg -n tool app/src/client/chat" })] });
  views.messageChanged(scope, { id: "tool-single-shell", role: "toolResult", text: "app/src/client/chat/ToolActivity.tsx:44: tool-activity", status: "completed", durationMs: 800 });
  views.flush(scope);
  const single = page.locator(".tool-activity").last();
  await single.locator(".activity-current").waitFor();
  await single.screenshot({ path: join(artifacts, "single-collapsed.png") });
  await single.locator(":scope > summary").click();
  assert.equal(await single.locator(".tool-detail").count(), 0);
  await single.locator(".tool-call > summary").click();
  assert.equal((await single.innerText()).split("rg -n tool app/src/client/chat").length - 1, 1, "the command is shown exactly once");
  assert.equal(await single.locator(".tool-detail").count(), 1);
  await single.screenshot({ path: join(artifacts, "single-expanded.png") });
  // A live run stays open between tool batches, including after reloading the view.
  app.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES('activity-live',?,'running','{}',?)").run(session.id, Date.now());
  views.messageChanged(scope, { id: 'standalone-user', role: 'user', text: '检查独立思考', runId: 'activity-live' });
  views.messageChanged(scope, { id: 'live-standalone', role: 'assistant', text: '独立正文', thinking: '独立思考', status: 'completed', runId: 'activity-live' });
  views.messageChanged(scope, { id: "live-user", role: "user", text: "连续调用", runId: "activity-live" });
  const publishLive = (message: ChatMessage) => {
    views.messageChanged(scope, { ...message, runId: "activity-live" }); views.flush(scope);
  };
  publishLive({ id: "live-first", role: "assistant", text: "", status: "completed", calls: [call("live-read", "read", { path: "first.ts" })] });
  publishLive({ id: "tool-live-read", role: "toolResult", text: "Done", status: "completed" });
  views.changed(scope);
  const live = page.locator('.tool-activity').last();
  await live.locator('.activity-current').filter({ hasText: 'first.ts' }).waitFor();
  assert.equal(await live.getAttribute('data-status'), 'running', 'finished batch waits for the next model decision');
  await page.reload();
  await live.locator('.activity-current').filter({ hasText: 'first.ts' }).waitFor();
  assert.equal(await live.getAttribute('data-status'), 'running', 'reload retains the open run boundary');
  const standalone = page.locator('.tool-activity').filter({ hasText: '独立思考' });
  assert.equal(await standalone.getAttribute('data-status'), 'completed', 'a new segment closes earlier standalone thinking in the same run');
  publishLive({ id: 'live-standalone', role: 'assistant', text: '独立正文', thinking: '独立思考', status: 'failed', error: '等待原生重试' });
  await page.getByText('等待原生重试', { exact: true }).waitFor();
  assert.equal(await standalone.getAttribute('data-status'), 'completed', 'completed thinking stays settled; the body owns its later failure');
  publishLive({ id: 'live-standalone', role: 'assistant', text: '独立正文', thinking: '独立思考', status: 'completed' });
  await live.evaluate(node => {
    (window as any).activityTransitions = [];
    new MutationObserver(records => (window as any).activityTransitions.push(...records.map(record => record.oldValue)))
      .observe(node, { attributes: true, attributeFilter: ['data-status'], attributeOldValue: true });
  });
  for (let batch = 0; batch < 3; batch++) {
    publishLive({ id: `live-batch-${batch}`, role: 'assistant', text: '', status: 'completed', calls: [call(`live-call-${batch}`, 'read', { path: `batch-${batch}.ts` })] });
    publishLive({ id: `tool-live-call-${batch}`, role: 'toolResult', text: 'Done', status: 'completed' });
    await live.locator('.activity-current:not(.activity-current-out)').filter({ hasText: `batch-${batch}.ts` }).waitFor();
    await page.waitForTimeout(80);
    assert.equal(await live.getAttribute('data-status'), 'running');
  }
  assert.deepEqual(await page.evaluate(() => (window as any).activityTransitions), [], 'no intermediate completed/unknown frames between batches');
  publishLive({ id: 'live-answer', role: 'assistant', text: '这一段已完成', status: 'completed' });
  await page.getByText('这一段已完成', { exact: true }).waitFor();
  await live.locator('.activity-status-completed').waitFor();
  assert.equal(await live.getAttribute('data-status'), 'completed', 'a body boundary settles the preceding finished process');
  publishLive({ id: 'live-answer', role: 'assistant', text: '', streaming: true, calls: [call('live-merged', 'read', { path: 'merged.ts' })] });
  await live.locator('.activity-current:not(.activity-current-out)').filter({ hasText: 'merged.ts' }).waitFor();
  assert.equal(await live.getAttribute('data-status'), 'running', 'new running facts reopen a process when its body boundary is removed');
  assert.equal(await live.locator('.activity-status-completed').count(), 0);
  await live.locator(':scope > summary').click();
  assert.equal(await live.locator('.tool-call').last().getAttribute('data-status'), 'running', 'merged rows still expose their true status');
  publishLive({ id: 'live-answer', role: 'assistant', text: '', streaming: false, status: 'completed', calls: [call('live-merged', 'read', { path: 'merged.ts' })] });
  publishLive({ id: 'tool-live-merged', role: 'toolResult', text: 'Done', status: 'completed' });
  await live.locator('.tool-call').last().filter({ has: page.locator('[aria-label="已完成 · 耗时未知"]') }).waitFor();
  assert.equal(await live.getAttribute('data-status'), 'running', 'resumed process still waits between tool batches');
  // Task notices have no run ID and must not hide the preceding messages' ownership.
  views.messageChanged(scope, { id: 'live-notice', role: 'notice', text: '子代理已完成', taskNotice: 'completed' });
  views.flush(scope);
  publishLive({ id: 'live-final', role: 'assistant', text: '合并调用已结束', status: 'completed' });
  await page.getByText('合并调用已结束', { exact: true }).waitFor();
  await live.locator('.activity-status-completed').waitFor();
  assert.equal(await live.getAttribute('data-status'), 'completed', 'final body closes the process before run settlement');
  assert.deepEqual(await page.evaluate(() => (window as any).activityTransitions), ['running', 'completed', 'running'], 'body boundaries settle completed work; removing one permits subsequent work');
  const liveProcess = await live.elementHandle();
  // A final process without a following reply closes only when the run settles.
  publishLive({ id: 'settle-user', role: 'user', text: '收尾' });
  publishLive({ id: 'settle-call', role: 'assistant', text: '', status: 'completed', calls: [call('settle-read', 'read', { path: 'settle.ts' })] });
  publishLive({ id: 'tool-settle-read', role: 'toolResult', text: 'Done', status: 'completed' });
  await live.locator('.activity-current').filter({ hasText: 'settle.ts' }).waitFor();
  assert.equal(await live.getAttribute('data-status'), 'running');
  assert.equal(await liveProcess!.getAttribute('data-status'), 'completed', 'the previous segment finishes when a new segment starts, before run settlement');
  assert.deepEqual(await page.evaluate(() => (window as any).activityTransitions), ['running', 'completed', 'running'], 'new segments do not change the closed process');
  app.store.db.prepare("UPDATE runs SET status='completed',endedAt=? WHERE id='activity-live'").run(Date.now());
  views.changed(scope);
  await live.locator('.activity-status-completed').waitFor();
  assert.equal(await standalone.getAttribute('data-status'), 'completed');
  assert.equal(await liveProcess!.getAttribute('data-status'), 'completed');
  assert.deepEqual(await page.evaluate(() => (window as any).activityTransitions), ['running', 'completed', 'running'], 'run settlement does not reopen the closed process');
  app.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES('activity-next',?,'running','{}',?)").run(session.id, Date.now());
  views.changed(scope);
  await page.waitForTimeout(100);
  assert.equal(await liveProcess!.getAttribute('data-status'), 'completed', 'a different run cannot reopen a settled process');
  assert.equal(await standalone.getAttribute('data-status'), 'completed', 'historical standalone thinking also remains settled');
  assert.deepEqual(await page.evaluate(() => (window as any).activityTransitions), ['running', 'completed', 'running']);
  // Reproduce the report: tools, a failed thinking request, then resumed tools in one run.
  const publishNext = (...messages: ChatMessage[]) => {
    for (const message of messages) views.messageChanged(scope, { ...message, runId: 'activity-next' });
    views.flush(scope);
  };
  const beforeMergedCount = await page.locator('.tool-activity').count();
  publishNext(
    { id: 'three-user', role: 'user', text: '检查连续过程合并' },
    { id: 'three-first', role: 'assistant', text: '', calls: [call('three-read', 'read', { path: 'finished.ts' })], status: 'completed' },
    { id: 'tool-three-read', role: 'toolResult', text: 'Done', status: 'completed' },
  );
  await live.locator('.activity-current').filter({ hasText: 'finished.ts' }).waitFor();
  assert.equal(await live.getAttribute('data-status'), 'running');
  const mergedNode = await live.elementHandle();
  await live.locator(':scope > summary').click();
  publishNext({ id: 'three-failed', role: 'assistant', text: '', thinking: '请求中断前的思考', status: 'failed', error: '模型请求失败: Upstream HTTP/2 stream failed' });
  await live.getByRole('alert').filter({ hasText: 'Upstream HTTP/2 stream failed' }).waitFor();
  assert.equal(await page.locator('.tool-activity').count(), beforeMergedCount + 1, 'failed thinking joins the existing process');
  assert.equal(await live.getAttribute('data-status'), 'running', 'recovery in an active run does not settle the process prematurely');
  publishNext(
    { id: 'three-next', role: 'assistant', text: '', calls: [call('three-next-read', 'read', { path: 'current.ts' })], status: 'completed' },
    { id: 'tool-three-next-read', role: 'toolResult', text: 'Reading', status: 'running' },
  );
  await live.locator('.tool-call').last().getByText('current.ts', { exact: true }).waitFor();
  assert.equal(await page.locator('.tool-activity').count(), beforeMergedCount + 1);
  assert.ok(await mergedNode!.evaluate(node => node.isConnected && node.hasAttribute('open')), 'failure and recovery preserve the card and its open state');
  assert.equal(await live.getAttribute('data-status'), 'running');
  assert.equal(await live.locator('.tool-activity').count(), 0, 'merged attempts never create nested process cards');
  assert.equal(await live.locator('.tool-call').count(), 2);
  await page.locator('.thread').evaluate(node => { node.scrollTop = node.scrollHeight; });
  await page.screenshot({ path: join(artifacts, 'merged-process-expanded.png') });
  await live.locator(':scope > summary').click();
  await live.locator('.activity-current:not(.activity-current-out)').filter({ hasText: 'current.ts' }).waitFor();
  await page.screenshot({ path: join(artifacts, 'merged-process-collapsed.png') });
  await page.reload();
  await live.locator('.activity-current').filter({ hasText: 'current.ts' }).waitFor();
  assert.equal(await page.locator('.tool-activity').count(), beforeMergedCount + 1, 'reload preserves one merged process');
  assert.equal(await live.getAttribute('data-status'), 'running');
  await live.locator(':scope > summary').click();
  await live.getByRole('alert').filter({ hasText: 'Upstream HTTP/2 stream failed' }).waitFor();
  await live.locator(':scope > summary').click();
  publishNext({ id: 'tool-three-next-read', role: 'toolResult', text: 'Done', status: 'completed' });
  publishNext({ id: 'three-reply', role: 'assistant', text: '恢复后的回复', status: 'completed' });
  await page.getByText('恢复后的回复', { exact: true }).waitFor();
  await live.locator('.activity-status-completed').waitFor();
  assert.equal(await live.getAttribute('data-status'), 'completed', 'the reply boundary closes the recovered process');
  app.store.db.prepare("UPDATE runs SET status='completed',endedAt=? WHERE id='activity-next'").run(Date.now());
  views.changed(scope);
  await live.locator('.activity-status-completed').waitFor();
  assert.equal(await live.getAttribute('data-status'), 'completed', 'successful continuation supersedes the earlier failed attempt');
  await live.locator(':scope > summary').click();
  await live.getByRole('alert').filter({ hasText: 'Upstream HTTP/2 stream failed' }).waitFor();
  assert.equal(await page.locator('.tool-activity').count(), beforeMergedCount + 1);
  // Error-only and stopped attempts also form one process, without empty nested cards.
  publishNext({ id: 'terminal-error', role: 'assistant', text: '', status: 'failed', error: '无思考正文的请求失败' });
  await live.locator('.activity-status[data-state="failed"]').waitFor();
  await live.locator(':scope > summary').click();
  await live.getByRole('alert').filter({ hasText: '无思考正文的请求失败' }).waitFor();
  const terminalNode = await live.elementHandle();
  publishNext({ id: 'terminal-stop', role: 'assistant', text: '', status: 'cancelled' });
  await live.getByText('回复已停止', { exact: true }).waitFor();
  assert.equal(await live.getAttribute('data-status'), 'cancelled');
  assert.ok(await terminalNode!.evaluate(node => node.isConnected && node.hasAttribute('open')));
  assert.equal(await page.locator('.tool-activity').count(), beforeMergedCount + 2, 'the independent reply separates two processes, but error and stop remain merged');
  assert.equal(await live.locator('.tool-activity').count(), 0);
  assert.deepEqual(errors, []);
  console.log(`PASS: merged consecutive tools, failed thinking and recovery; stable status across tool batches, provisional replies, merges and reload; run settlement, layered tool disclosures, streaming refresh, keyboard, colors and 6 responsive widths. Screenshots: ${artifacts}`);
} finally {
  await browser?.close();
  await app?.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
  else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
