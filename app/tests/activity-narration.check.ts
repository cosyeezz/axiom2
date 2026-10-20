// Assistant narration is a stable boundary between independently folded processes.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { ChatMessage } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-narration-"));
const artifacts = resolve("test-results/activity-narration");
mkdirSync(artifacts, { recursive: true });
mkdirSync(join(root, "workspace"));
mkdirSync(join(root, "pi"));
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
const settled = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "workspace"), authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const call = (id: string, command: string) => ({ id, name: "bash", input: JSON.stringify({ command }) });
  const first = "先检查连接，再确认远端目录。";
  const second = "连接已经确认，接下来检查目录内容。";
  const messages: ChatMessage[] = [
    { id: "user", role: "user", text: "帮我检查远端环境" },
    { id: "seg-1", role: "assistant", text: first, thinking: "先确认连接方式。", status: "completed", calls: [call("connect", "ssh remote")] },
    { id: "tool-connect", role: "toolResult", toolCallId: "connect", text: "connected", status: "completed", durationMs: 2200 },
    { id: "seg-2", role: "assistant", text: "", thinking: "连接正常，核对当前目录。", status: "completed", calls: [call("probe", "pwd")] },
    { id: "tool-probe", role: "toolResult", toolCallId: "probe", text: "/tmp", status: "completed", durationMs: 7300 },
    { id: "seg-3", role: "assistant", text: second, status: "running", streaming: true },
  ];
  for (const message of messages) views.messageChanged(scope, message);
  views.flush(scope);
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(value => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  const groups = page.locator("#messages > .tool-activity");
  const body = (text: string) => page.locator("#messages > .log-row .message-body").filter({ hasText: text });
  await body(second).waitFor();
  await page.locator("#prompt").fill("保留草稿");
  assert.equal(await groups.count(), 2, "thinking before narration and calls after it are separate processes");
  const secondBody = await body(second).elementHandle();
  const earlierProcess = await groups.nth(1).elementHandle();
  await groups.nth(1).locator(":scope > summary").click();
  assert.equal(await groups.nth(1).locator(".tool-call").count(), 2);

  // The first late call belongs after the already-visible body, preserving both
  // the body's DOM node and the user's expansion of the earlier process.
  const withCalls: ChatMessage = { ...messages.at(-1)!, calls: [call("list", "ls -la")] };
  views.messageChanged(scope, withCalls);
  views.flush(scope);
  await page.waitForFunction(() => document.querySelectorAll("#messages > .tool-activity").length === 3);
  assert.equal(await secondBody!.evaluate(node => node.isConnected), true, "late calls never move/remount the body");
  assert.equal(await earlierProcess!.evaluate(node => node.isConnected && node.hasAttribute("open")), true, "earlier expansion survives new calls");
  assert.equal(await groups.nth(1).locator(".tool-call").count(), 2, "new call does not merge across narration");
  assert.equal(await groups.nth(2).getAttribute("open"), null);
  await groups.nth(1).locator(":scope > summary").click();
  views.messageChanged(scope, { ...withCalls, text: `${second} 正在读取。` });
  views.flush(scope);
  await body("正在读取。").waitFor();
  assert.equal(await secondBody!.evaluate(node => node.isConnected), true, "streaming keeps the body stable");
  views.messageChanged(scope, { id: "tool-list", role: "toolResult", toolCallId: "list", text: "logs", status: "completed", durationMs: 800 });
  views.messageChanged(scope, { ...withCalls, text: `${second} 正在读取。`, status: "completed", streaming: false });
  views.messageChanged(scope, { id: "reply", role: "assistant", text: "已确认远端目录清单。", status: "completed" });
  views.flush(scope);
  await body("已确认远端目录清单。").waitFor();

  const sequence = () => page.locator("#messages > .tool-activity, #messages > .log-row").evaluateAll(nodes => nodes.map(node => node.matches("details") ? "process" : node.querySelector(".message-body")?.textContent?.includes("先检查连接") ? "first" : node.querySelector(".message-body")?.textContent?.includes("连接已经确认") ? "second" : node.getAttribute("aria-label") === "用户消息" ? "user" : "final"));
  const expected = ["user", "process", "first", "process", "second", "process", "final"];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await settled(page);
    assert.deepEqual(await sequence(), expected, "chronological conversation flow");
    assert.equal(await groups.count(), 3);
    assert.equal(await page.locator(".tool-call, .thinking-block").count(), 0, "closed processes mount no detail rows");
    assert.ok(await body(first).isVisible());
    assert.ok(await body(second).isVisible());
    assert.equal(await page.getByText(first, { exact: true }).count(), 1);
    assert.equal(await body(first).evaluate(node => !!node.closest("details")), false);
    await page.screenshot({ path: join(artifacts, `${width}-collapsed.png`) });
    for (let i = 0; i < 3; i++) await groups.nth(i).locator(":scope > summary").click();
    await settled(page);
    assert.deepEqual(await sequence(), expected, "opening processes never relocates narration");
    assert.equal(await groups.nth(0).locator(".tool-call").count(), 0, "thinking slice excludes subsequent calls");
    assert.equal(await groups.nth(0).locator(".thinking-block").count(), 1);
    assert.equal(await groups.nth(1).locator(".tool-call").count(), 2);
    assert.equal(await groups.nth(1).locator(".thinking-block").count(), 1, "only subsequent thinking belongs here");
    assert.equal(await groups.nth(2).locator(".tool-call").count(), 1);
    assert.equal(await groups.locator(".message-body").count(), 0, "processes contain no assistant body copies");
    assert.equal(await groups.locator(".tool-detail, .thinking-body").count(), 0, "inner rows still start closed");
    assert.equal(await page.locator("#prompt").inputValue(), "保留草稿");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no horizontal overflow at ${width}px`);
    await page.screenshot({ path: join(artifacts, `${width}-expanded.png`) });
    for (let i = 0; i < 3; i++) await groups.nth(i).locator(":scope > summary").click();
  }
  // Message-level failure/stop notices belong to the body, not each process slice.
  await groups.nth(2).locator(":scope > summary").click();
  views.messageChanged(scope, { ...withCalls, text: `${second} 正在读取。`, status: "failed", streaming: false, error: "连接中断，请重试。" });
  views.flush(scope);
  await page.locator("#messages > .log-row .execution-alert").waitFor();
  assert.equal(await groups.nth(2).locator(':scope > summary .activity-title').innerText(), '执行失败', 'a closed process retains terminal assistant failure');
  assert.equal(await page.locator("#messages .execution-alert").count(), 1, "failed reply has one notice even with its calls expanded");
  views.messageChanged(scope, { ...withCalls, text: `${second} 正在读取。`, status: "cancelled", streaming: false });
  views.flush(scope);
  await page.locator("#messages > .log-row .message-state").waitFor();
  assert.equal(await groups.nth(2).locator(':scope > summary .activity-title').innerText(), '执行已停止', 'a closed process retains cancellation without an intermediate state');
  assert.equal(await page.locator("#messages .message-state").count(), 1, "stopped reply has one notice even with its calls expanded");
  views.messageChanged(scope, { ...withCalls, text: `${second} 正在读取。`, status: "completed", streaming: false });
  views.flush(scope);
  await page.reload();
  await body("已确认远端目录清单。").waitFor();
  assert.deepEqual(await sequence(), expected, "reloading reconstructs the same flow");
  assert.deepEqual(errors, []);
  console.log(`PASS: chronological thinking/body/call slices, late calls preserve body and earlier expansion, streaming, independent folding, reload, desktop/mobile. Screenshots: ${artifacts}`);
} finally {
  await browser?.close();
  await app?.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
  else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
