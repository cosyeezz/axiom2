import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { SessionDrafts } from "../src/server/session-drafts.js";
import { startServer } from "../src/server/index.js";
import { type AgentViews } from "../src/server/agents/views.js";
import { agentScope, emptyAgent } from "../src/shared/agent.js";
import { AppError, type Session, type Workspace } from "../src/shared/protocol.js";
const root = mkdtempSync(join(tmpdir(), "axiom-experience-"));
mkdirSync(join(root, "project")); mkdirSync(join(root, "pi"));
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
const app = await startServer({ root, port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const releaseGates: (() => void)[] = [];
const fixtureReceipts = new Map<string, "pending" | "committed">();
try {
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "project"), authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const summaryText = '<axiom-summary>会话性能优化</axiom-summary>\n## 完整交接摘要\n\n**验证：**支持 Markdown 排版。\n\n- 保留上下文\n- 支持 `inline code`\n\n> 继续处理剩余任务\n\n| 项目 | 状态 |\n| --- | --- |\n| 渲染 | 完成 |\n\n```ts\nconst compact = true;\n```\n\n<script>window.__compressionInjected = true</script>';
  views.messageChanged(scope, { id: "compact", role: "notice", text: summaryText + "\n\n" + " ".repeat(16000), compression: { number: 2, title: "会话性能优化", before: 100000, after: 6000 } });
  const originalCommand = app.agents.command.bind(app.agents);
  app.agents.command = (async (c: any, internal?: any) => {
    if (c.op === "message.get" && c.params?.id === "compact") return { id: "compact", role: "notice", text: `${summaryText}\n\n### 完整摘要补充\n\n**已加载全文**` };
    if (c.op === "agent.inputs" && c.params.ids.every((id: string) => fixtureReceipts.has(id)))
      return c.params.ids.map((id: string) => ({ id, consumed: false, active: true, queued: false, receipt: { status: fixtureReceipts.get(id), data: { runId: "accepted-run" } } }));
    return originalCommand(c, internal);
  }) as typeof app.agents.command;
  for (let i = 0; i < 600; i++) views.messageChanged(scope, { id: `m${i}`, role: i % 2 ? "assistant" : "user", text: `消息 ${i}\n这是用于检查滚动和缓存的内容。`, thinking: i % 2 ? "Large snapshot boundary. ".repeat(200) : undefined });
  views.flush(scope);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const subscriptions: string[] = [];
  page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => {
    const value = JSON.parse(String(payload));
    if (value.op === "subscribe") subscriptions.push(value.params.scope);
  }));
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((scope) => sessionStorage.setItem("view", JSON.stringify(scope)), scope);
  await page.goto(app.origin);
  await page.getByText("消息 599", { exact: false }).waitFor();
  assert.equal(await page.getByRole("button", { name: "更早的消息" }).count(), 0);
  assert.equal(await page.locator(".log-row").count(), 600);
  assert.equal(subscriptions.filter((scope) => scope.startsWith("message:")).length, 0);
  assert.equal(subscriptions.filter((scope) => scope.startsWith("messages:")).length, 1);
  await page.getByRole("button", { name: "回到最上", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#thread")!.scrollTop < 2);
  await page.getByRole("button", { name: "向下滚动一屏", exact: true }).click();
  const moved = await page.locator("#thread").evaluate((el) => ({ top: el.scrollTop, height: el.clientHeight }));
  assert.ok(moved.top > moved.height * .8 && moved.top < moved.height);
  await page.getByRole("button", { name: "回到最下", exact: true }).click();
  await page.waitForFunction(() => { const el = document.querySelector("#thread")!; return el.scrollHeight - el.scrollTop - el.clientHeight < 2; });
  await page.waitForFunction(() => (document.querySelector('[aria-label="回到最下"]') as HTMLButtonElement)?.disabled);
  await page.getByRole("button", { name: "回到最上", exact: true }).click();
  const card = page.locator(".compaction-card");
  assert.equal(await card.locator(".compression-summary").count(), 0, "closed card does not mount summary");
  await card.locator("summary").focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "完整交接摘要" }).waitFor();
  assert.equal(await card.locator("li").count(), 2);
  assert.equal(await card.locator("table tbody tr").count(), 1);
  assert.equal(await card.locator("blockquote").count(), 1);
  assert.equal(await card.locator("strong").first().innerText(), "验证：");
  assert.equal(await card.locator("pre code").innerText(), "const compact = true;");
  assert.doesNotMatch(await card.innerText(), /axiom-summary/);
  assert.equal(await card.locator("script").count(), 0);
  assert.equal(await page.evaluate(() => (window as any).__compressionInjected), undefined);
  await card.getByRole("button", { name: "展开完整文本" }).click();
  await card.getByRole("heading", { name: "完整摘要补充" }).waitFor();
  assert.equal(await card.getByRole("heading", { name: "完整交接摘要" }).count(), 1, "full text replaces the preview");
  assert.equal(await card.locator("strong").last().innerText(), "已加载全文");
  const artifacts = resolve("test-results/session-experience"); mkdirSync(artifacts, { recursive: true });
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.ok(await card.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `card content fits ${width}px`);
    const rects = await page.evaluate(() => {
      const nav = document.querySelector(".thread-navigation")!.getBoundingClientRect();
      const composer = document.querySelector(".composer")!.getBoundingClientRect();
      return { navBottom: nav.bottom, composerTop: composer.top };
    });
    assert.ok(rects.navBottom < rects.composerTop);
    await page.screenshot({ path: join(artifacts, `${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const realInfo = views.info.bind(views);
  views.info = (target) => ({ ...realInfo(target), selection: { provider: "fixture", id: "fixture", thinking: "off" } });
  views.publish(agentScope(scope), views.info(scope));
  views.publish("configuration", { revision: "fixture", providerCount: 1, modelCount: 1, available: [{ provider: "fixture", id: "fixture", name: "fixture", levels: ["off"], input: ["text"] }], dataRoot: root });
  // Hold the real command handler: the optimistic bubble must appear before any receipt.
  const original = app.agents.command.bind(app.agents);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; }); releaseGates.push(release);
  app.agents.command = (async (c: any, internal?: any) => {
    if (c.op === "prompt") { fixtureReceipts.set(c.requestId, "pending"); await gate; fixtureReceipts.delete(c.requestId); }
    return original(c, internal);
  }) as typeof app.agents.command;
  await page.locator("#prompt").fill("立即出现的乐观消息");
  await page.waitForFunction(() => !(document.querySelector('[aria-label="发送消息"]') as HTMLButtonElement)?.disabled);
  await page.locator("#prompt").press("Enter");
  await page.locator(".user-text").filter({ hasText: "立即出现的乐观消息" }).waitFor({ timeout: 2000 });
  assert.equal(await page.locator("#prompt").inputValue(), "");
  await page.getByText("正在发送…", { exact: true }).waitFor();
  release();
  await page.getByRole("status").filter({ hasText: "发送未完成" }).waitFor();
  assert.equal(await page.locator("#prompt").inputValue(), "");
  assert.equal(await page.getByRole("button", { name: "恢复到输入框" }).count(), 0);
  assert.equal(await page.locator(".user-text").filter({ hasText: "立即出现的乐观消息" }).count(), 1, "confirmed rejection retains the original message");
  let acceptedRequest = "";
  app.agents.command = (async (c: any, internal?: any) => {
    if (c.op !== "prompt") return original(c, internal);
    acceptedRequest = c.requestId;
    fixtureReceipts.set(c.requestId, "committed");
    return { runId: "accepted-run", status: "accepted" };
  }) as typeof app.agents.command;
  await page.locator("#prompt").fill("下一条正常消息");
  await page.locator("#prompt").press("Enter");
  await page.getByText("已受理，等待进入会话", { exact: true }).waitFor();
  views.messageChanged(scope, { id: "accepted-run", inputIds: [acceptedRequest], role: "user", text: "下一条正常消息" });
  views.flush(scope);
  await page.waitForFunction(() => !document.body.textContent?.includes("已受理，等待进入会话"));
  assert.equal(await page.locator(".user-text").filter({ hasText: "下一条正常消息" }).count(), 1, "receipt and native message reconcile without duplicate bubbles");
  let rejectSteering!: () => void;
  const steeringGate = new Promise<void>((resolve) => { rejectSteering = resolve; }); releaseGates.push(rejectSteering);
  app.agents.command = (async (c: any, internal?: any) => {
    if (c.op !== "prompt") return original(c, internal);
    assert.equal(c.params.mode, "steer");
    fixtureReceipts.set(c.requestId, "pending");
    await steeringGate;
    fixtureReceipts.delete(c.requestId);
    throw new AppError("INPUT_REJECTED", "测试追加输入被拒绝");
  }) as typeof app.agents.command;
  const selectedInfo = views.info(scope);
  views.publish(agentScope(scope), { ...selectedInfo, run: { id: "active-run", sessionId: scope.sessionId, status: "running", selection: selectedInfo.selection!, startedAt: Date.now(), endedAt: null, error: null } });
  await page.getByRole("button", { name: "停止执行", exact: true }).waitFor();
  await page.locator("#prompt").fill("追加内容");
  await page.locator("#prompt").press("Enter");
  await page.getByText("正在排队…", { exact: true }).waitFor();
  await page.locator("#prompt").fill("继续输入的内容");
  rejectSteering();
  await page.getByRole("status").filter({ hasText: "测试追加输入被拒绝" }).waitFor();
  assert.equal(await page.locator("#prompt").inputValue(), "继续输入的内容");
  assert.equal(await page.getByRole("button", { name: "恢复编辑", exact: true }).count(), 0);
  assert.equal(await page.locator(".steering-queue-item").count(), 1);
  assert.match(await page.locator(".steering-queue-item").innerText(), /追加内容/);
  // An input present in both the server queue and local placeholders must still
  // expose uncertainty/query errors, without rendering duplicate rows or replaying.
  let uncertainId = "", queryPhase = "unknown", sends = 0;
  app.agents.command = (async (c: any, internal?: any) => {
    if (c.op === "prompt") {
      sends++;
      uncertainId = c.requestId;
      views.queues.set(scope.sessionId, [{ id: uncertainId, text: c.params.text, mode: "steer" }]);
      views.publish(agentScope(scope), { ...selectedInfo, queue: views.queues.get(scope.sessionId),
        run: { id: "active-run", sessionId: scope.sessionId, status: "running", selection: selectedInfo.selection!, startedAt: Date.now(), endedAt: null, error: null } });
      throw new AppError("UNCERTAIN", "测试追加输入受理未确认");
    }
    if (c.op === "agent.inputs" && c.params.ids.includes(uncertainId)) {
      if (queryPhase === "error") throw new AppError("READ_FAILED", "测试核实读取失败");
      return [{ id: uncertainId, consumed: queryPhase === "consumed", active: true, queued: true,
        receipt: { status: "uncertain", data: { message: "测试追加输入受理未确认" } } }];
    }
    return original(c, internal);
  }) as typeof app.agents.command;
  await page.locator("#prompt").fill("待确认的追加内容");
  await page.locator("#prompt").press("Enter");
  const pendingRow = page.locator(".steering-queue-item").filter({ hasText: "待确认的追加内容" });
  const pendingStatus = pendingRow.getByRole("status");
  await pendingStatus.filter({ hasText: "发送结果未确认" }).waitFor();
  assert.equal(await pendingRow.count(), 1);
  queryPhase = "error";
  await pendingStatus.filter({ hasText: "发送结果核实失败：测试核实读取失败" }).waitFor();
  queryPhase = "unknown";
  await pendingStatus.filter({ hasText: "发送结果未确认" }).waitFor();
  assert.equal(await page.locator("#prompt").inputValue(), "", "unknown result must not restore potentially consumed input");
  queryPhase = "consumed";
  views.queues.delete(scope.sessionId);
  views.publish(agentScope(scope), selectedInfo);
  await pendingRow.waitFor({ state: "detached" });
  assert.equal(sends, 1, "read-only reconciliation never resends");
  // A saved failed submission restores as its own message after reload, never as editable input.
  const reloadSession = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const reloadScope = { ...scope, sessionId: reloadSession.id }, failedId = crypto.randomUUID();
  await assert.rejects(app.store.external({ requestId: failedId, op: "prompt", ...reloadScope, params: { text: "刷新后仍保留的失败消息" } },
    async () => { throw new AppError("MODEL_UNAVAILABLE", "fixture unavailable"); }));
  new SessionDrafts(app.store).save(reloadScope, { revision: 0, writer: "reload-fixture", sequence: 1,
    submissionId: failedId, draft: { text: "刷新后仍保留的失败消息", attachment: null } });
  const reloadPage = await browser.newPage();
  await reloadPage.addInitScript((target) => sessionStorage.setItem("view", JSON.stringify(target)), reloadScope);
  await reloadPage.goto(app.origin);
  await reloadPage.locator(".user-text").filter({ hasText: "刷新后仍保留的失败消息" }).waitFor();
  assert.equal(await reloadPage.locator("#prompt").inputValue(), "");
  await reloadPage.reload();
  await reloadPage.locator(".user-text").filter({ hasText: "刷新后仍保留的失败消息" }).waitFor();
  assert.equal(await reloadPage.locator("#prompt").inputValue(), "");
  await reloadPage.close();
  assert.deepEqual(errors, []);
  console.log("PASS: immediate bubble, failed messages stay separate from drafts, queued uncertainty/error feedback, no replay, compaction and responsive layout");
} catch (error) {
  console.error((error as Error).stack); throw error;
} finally {
  releaseGates.forEach(release => release());
  await browser.close(); await app.close(); rmSync(root, { recursive: true, force: true });
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
}
