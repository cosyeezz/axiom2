// Full-message reads are scoped to a preview and history generation, never to an id alone.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import { threadScope, type ChatMessage } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-full-message-"));
mkdirSync(join(root, "pi")); mkdirSync(join(root, "project"));
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "project"), authorized: true } }) as Workspace;
  const create = () => app!.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const first = create(), second = create();
  const scope = { workspaceId: workspace.id, sessionId: first.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  let revision = 0;
  const revise = () => app!.agents.publish(threadScope(scope), { ...views.thread(scope), contextRevision: ++revision });
  const preview = (label: string) => `${label}\n\n3. 第三项\n4. 第四项\n\n${"预览正文。".repeat(5000)}`;
  const update = (text: string) => { views.messageChanged(scope, { id: "answer", role: "assistant", text }); views.flush(scope); };
  update(preview("最初预览"));
  views.messageChanged({ ...scope, sessionId: second.id }, { id: "other", role: "assistant", text: "另一会话正文" });
  views.flush({ ...scope, sessionId: second.id });
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 320, height: 640 }, hasTouch: true });
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  let mode: "success" | "fail" | "hold" = "success";
  let release: (() => void) | undefined, received: (() => void) | undefined;
  const pendingRequest = () => new Promise<void>(resolve => { received = resolve; });
  const full: Record<string, ChatMessage> = {
    answer: { id: "answer", role: "assistant", text: `# 完整回复\n\n3. 第三项\n4. 第四项\n\n${"LONG_TOKEN_".repeat(500)}\n\n\`\`\`js\nconst ok = true;\n\`\`\`` },
    summary: { id: "summary", role: "assistant", text: "# 完整压缩摘要\n\n这是全文。" },
    user: { id: "user", role: "user", text: "用户完整原文" },
  };
  await page.routeWebSocket("**/ws", socket => {
    const server = socket.connectToServer();
    socket.onMessage(raw => {
      const request = JSON.parse(raw.toString()) as { op: string; requestId: string; params?: { id?: string } };
      if (request.op !== "message.get") { server.send(raw); return; }
      const respond = () => socket.send(JSON.stringify({ type: "receipt", requestId: request.requestId, ok: true, data: full[request.params!.id!] }));
      if (mode === "hold") { release = respond; received?.(); }
      else if (mode === "fail") socket.send(JSON.stringify({ type: "receipt", requestId: request.requestId, ok: false, error: { code: "READ_FAILED", message: "全文读取失败夹具" } }));
      else respond();
    });
    server.onMessage(raw => socket.send(raw));
  });
  await page.goto(app.origin);
  const answer = page.getByRole("article", { name: "助手回复", exact: true });
  const expand = () => answer.getByRole("button", { name: "展开完整文本", exact: true });
  const heading = () => answer.getByRole("heading", { name: "完整回复", exact: true });
  await expand().click(); await heading().waitFor();
  assert.equal(await answer.getByText(/最初预览/).count(), 0);
  assert.equal(await answer.locator("ol").evaluate(node => (node as HTMLOListElement).start), 3);
  assert.equal(await answer.locator(":scope > div > pre").count(), 0);
  assert.ok(await page.locator(".thread").evaluate(node => node.scrollWidth <= node.clientWidth + 1));

  update(preview("同ID的新预览")); await expand().waitFor();
  assert.equal(await heading().count(), 0);
  mode = "fail"; await expand().click();
  await answer.getByRole("alert").filter({ hasText: "全文读取失败夹具" }).waitFor();
  mode = "success"; await answer.getByRole("button", { name: "重新加载完整文本", exact: true }).click();
  await heading().waitFor(); assert.equal(await answer.getByRole("alert").count(), 0);

  // The preview is unchanged: a native history rebuild must still invalidate the full text.
  revise(); await expand().waitFor(); assert.equal(await heading().count(), 0);
  mode = "hold"; const historyRequest = pendingRequest(); await expand().click(); await historyRequest;
  await page.waitForFunction(() => document.querySelector(".message-full-control button")?.hasAttribute("disabled"));
  assert.ok(release);
  revise(); await expand().waitFor(); release!(); release = undefined;
  mode = "success"; await expand().click(); await heading().waitFor();
  assert.equal(await answer.getByRole("button", { name: "展开完整文本", exact: true }).count(), 0);

  update(preview("切换前预览")); await expand().waitFor();
  mode = "hold"; const sessionRequest = pendingRequest(); await expand().click(); await sessionRequest;
  await answer.getByRole("button", { name: "正在加载…", exact: true }).waitFor();
  assert.ok(release);
  // Keyboard selection bypasses the pointer delay used to detect double-click renaming.
  await page.setViewportSize({ width: 1440, height: 900 });
  const otherSession = page.locator(`[data-session-id="${second.id}"] button.history-item`);
  await otherSession.waitFor({ state: "visible" });
  await otherSession.press("Enter");
  try {
    await page.waitForFunction(id => document.querySelector(`[data-session-id="${id}"] button.history-item`)?.getAttribute("aria-current") === "true", second.id);
    await page.getByText("另一会话正文", { exact: true }).waitFor();
  } catch (error) {
    console.error("Session switch diagnostics:", await page.evaluate(() => ({
      view: sessionStorage.getItem("view"),
      selected: document.querySelector('.history-row:has([aria-current="true"])')?.getAttribute("data-session-id"),
      text: document.querySelector(".thread")?.textContent?.slice(0, 1200),
    })), { errors });
    throw error;
  }
  (release as () => void)(); release = undefined;
  assert.equal(await heading().count(), 0);
  await page.locator(`[data-session-id="${first.id}"] .history-item`).press("Enter");
  await expand().waitFor(); assert.equal(await heading().count(), 0);

  mode = "success";
  views.messageChanged(scope, { id: "summary", role: "assistant", text: preview("压缩预览"), compression: { number: 1, title: "摘要", before: 20000, after: 1000 } });
  views.messageChanged(scope, { id: "user", role: "user", text: preview("用户预览") }); views.flush(scope);
  const card = page.locator(".compaction-card"); await card.locator("summary").click();
  await card.getByRole("button", { name: "展开完整文本", exact: true }).click();
  await card.getByRole("heading", { name: "完整压缩摘要", exact: true }).waitFor();
  revise();
  await card.getByRole("button", { name: "展开完整文本", exact: true }).waitFor();
  assert.equal(await card.getByRole("heading", { name: "完整压缩摘要", exact: true }).count(), 0);
  const user = page.getByRole("article", { name: "用户消息", exact: true });
  await user.getByRole("button", { name: "展开完整文本", exact: true }).click();
  await user.getByText("用户完整原文", { exact: true }).waitFor();
  assert.equal(await user.getByText(/用户预览/).count(), 0);

  // Each hidden field loads independently; reading thinking must retain loaded tool input.
  full.answer = { id: "answer", role: "assistant", text: "", thinking: `${"思考内容。".repeat(4000)}思考全文末尾`, calls: [{ id: "read-call", name: "read", input: JSON.stringify({ path: `${"long-path/".repeat(2000)}工具输入末尾` }) }] };
  views.messageChanged(scope, full.answer); views.flush(scope);
  const activity = page.locator(".process-live");
  await activity.locator(':scope > summary').click();
  await activity.locator(".tool-call > summary").click();
  await activity.locator(".tool-detail > pre").first().filter({ hasText: "工具输入末尾" }).waitFor();
  assert.equal(await activity.getByRole("button", { name: /^继续加载/ }).count(), 0, "tool input loads in full without paging");
  assert.equal(await activity.getByRole("button", { name: "展开完整文本", exact: true }).count(), 0, "hidden fields do not add a redundant whole-message control");
  await activity.locator(".thinking-header").click();
  await activity.locator(".thinking-body").getByText(/思考全文末尾/).waitFor();
  assert.equal(await activity.getByRole("button", { name: /^继续加载/ }).count(), 0, "thinking loads in full without paging");
  assert.match(await activity.locator(".tool-detail > pre").first().innerText(), /工具输入末尾/);
  assert.deepEqual(errors, []);
  console.log("Full-message UI passed: Markdown replacement, overflow, retry, preview/history invalidation, late response/session isolation, compaction and user text.");
} finally {
  await browser?.close(); await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
