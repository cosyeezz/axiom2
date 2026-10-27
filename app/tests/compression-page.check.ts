import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isCompressionRequest } from "./compression-memory-fixture.js";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Selection } from "../src/shared/agent.js";
import type { HistoryIndex } from "../src/shared/history.js";
import { defaultAutoCompression } from "../src/shared/compression.js";
import type { Command, Scope, Session, Workspace } from "../src/shared/protocol.js";

// Real server, persisted pi JSONL, WebSocket subscriptions and native compact().
// Only the provider is loopback-controlled; chat and native compaction use no external API.
const root = mkdtempSync(join(tmpdir(), "axiom-compression-page-"));
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
const requests: { model: string; tools?: unknown[]; messages: { role: string; content: unknown }[] }[] = [];
const responses: ServerResponse[] = [];
const fixtureErrors: string[] = [];
let completeSummaries = false;
let failSummaries = false;
const fixture = createServer(async (req, res) => {
  try {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (!isCompressionRequest(body)) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      reply(res, "已保存的真实会话回复");
      return;
    }
    requests.push(body);
    responses.push(res);
    if (failSummaries) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "压缩模型额度不足 quota_exhausted; api_key=sk-fixture-secret", type: "invalid_request_error" } }));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.flushHeaders(); // Deliberately hold each model request until the test completes/cancels it.
    if (completeSummaries) reply(res);
  } catch (error) {
    fixtureErrors.push(String(error));
    res.writeHead(500).end();
  }
});
const reply = (res: ServerResponse, content = "## Goal\n浏览器真实压缩摘要 <script>window.__compressionInjected=true</script>\n\n- **保留上下文**\n\n```ts\nconst compact = true;\n```") => {
  const chunk = (delta: unknown, finish_reason: string | null = null) =>
    res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "summary-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  chunk({ role: "assistant", content });
  chunk({}, "stop");
  res.end("data: [DONE]\n\n");
};
const wait = async (check: () => boolean, message: string) => {
  const end = Date.now() + 30000;
  while (!check()) {
    assert.ok(Date.now() < end, message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
let app: Awaited<ReturnType<typeof startServer>> | undefined;
let browser: Browser | undefined;
try {
  const project = join(root, "project");
  mkdirSync(project);
  mkdirSync(join(root, "pi"));
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  writeFileSync(join(root, "pi/models.json"), JSON.stringify({ providers: {
    "compression-page-fixture": {
      api: "openai-completions",
      baseUrl: `http://127.0.0.1:${(fixture.address() as { port: number }).port}/v1`,
      models: [
        { id: "chat-model", name: "Chat fixture", contextWindow: 64000, maxTokens: 1000 },
        { id: "summary-model", name: "Summary fixture", reasoning: true, contextWindow: 64000, maxTokens: 1000 },
      ],
    },
  } }));
  writeFileSync(join(root, "pi/auth.json"), JSON.stringify({ "compression-page-fixture": { type: "api_key", key: "loopback-only" } }));
  writeFileSync(join(root, "pi/settings.json"), JSON.stringify({ compaction: { enabled: false }, retry: { enabled: false } }));
  app = await startServer({ root, port: 0, dev: !process.env.AXIOM_TEST_PRODUCTION });
  const server = app;
  const workspace = server.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const chat: Selection = { provider: "compression-page-fixture", id: "chat-model", thinking: "off" };
  server.agents.memories.runner!.execute = async input => ({ answer: input.kind === "organize" ? "[]" : "压缩验证", incomplete: false });
  const create = async (title: string, history: boolean) => {
    const session = server.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    const scope: Scope = { workspaceId: workspace.id, sessionId: session.id };
    server.store.execute({ ...scope, requestId: randomUUID(), op: "session.rename", params: { title } });
    await server.agents.command({ ...scope, requestId: randomUUID(), op: "agent.model", params: { selection: chat } });
    let file: string | undefined;
    if (history) {
      await server.agents.command({ ...scope, requestId: randomUUID(), op: "prompt", params: { text: `${title} 已保存消息` } });
      await wait(() => !server.agents.active(scope), "seed chat did not settle");
      await server.agents.releaseIdle(scope);
      file = String(server.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(session.id)!.file);
      server.agents.refresh(scope);
      assert.equal(server.agents.thread(scope).ids.length, 2);
    }
    return { ...scope, title, file };
  };
  const empty = await create("压缩空会话", false);
  const a = await create("压缩会话 A", true);
  const b = await create("压缩会话 B", true);
  assert.deepEqual(server.store.compressionPreferences(), { auto: defaultAutoCompression });
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = [], nativeDialogs: string[] = [], commands: Command[] = [];
  const preferenceSnapshots: unknown[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", async (dialog) => { nativeDialogs.push(dialog.type()); await dialog.dismiss(); });
  page.on("websocket", (socket) => {
    socket.on("framesent", ({ payload }) => {
      const message = JSON.parse(payload.toString()) as Command;
      if (message.op) commands.push(message);
    });
    socket.on("framereceived", ({ payload }) => {
      const message = JSON.parse(payload.toString());
      if (message.scope === "compression-preferences") preferenceSnapshots.push(message.data);
    });
  });
  await page.addInitScript((view) => {
    if (!sessionStorage.getItem("view")) sessionStorage.setItem("view", JSON.stringify(view));
  }, { workspaceId: empty.workspaceId, sessionId: empty.sessionId });
  await page.goto(server.origin);
  const trigger = page.locator('[data-od-id="background-compression-trigger"]');
  const dialog = page.getByRole("dialog", { name: "后台压缩", exact: true });
  const expectTriggerColor = async (variable: string) => {
    // Sample the settled color: normal-motion controls transition from running to idle.
    await page.waitForFunction((token) => {
      const button = document.querySelector('[data-od-id="background-compression-trigger"]')!;
      const probe = document.createElement("span"); probe.style.color = `var(${token})`; button.append(probe);
      const expected = getComputedStyle(probe).color; probe.remove();
      return getComputedStyle(button.querySelector("svg")!).color === expected;
    }, variable);
    const colors = await trigger.evaluate((button, token) => {
      const probe = document.createElement("span"); probe.style.color = `var(${token})`; button.append(probe);
      const expected = getComputedStyle(probe).color; probe.remove();
      return { actual: getComputedStyle(button.querySelector("svg")!).color, expected };
    }, variable);
    assert.equal(colors.actual, colors.expected, `compression icon uses ${variable}`);
  };
  const modelDisplay = dialog.getByRole("region", { name: "会话压缩模型" });
  const state = (value: string) => dialog.locator(`.compression-status[data-state="${value}"]`).waitFor();
  const expectEnabled = async (name: string) => {
    await page.waitForFunction((label) => [...document.querySelectorAll<HTMLButtonElement>("dialog.compression-page button")]
      .some((button) => button.textContent?.trim() === label && !button.disabled), name);
    assert.equal(await dialog.getByRole("button", { name, exact: true }).isEnabled(), true);
  };
  const open = async () => { await trigger.click(); await dialog.waitFor(); };
  const close = async () => {
    await dialog.getByRole("button", { name: "关闭压缩详情，返回会话" }).click();
    await dialog.waitFor({ state: "detached" });
    assert.ok(await trigger.evaluate((el) => document.activeElement === el), "closing restores trigger focus");
  };
  const closeOutside = async () => {
    // Changing reduced motion can restart the drawer animation; measure its settled edge.
    await dialog.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))));
    const box = await dialog.boundingBox();
    assert.ok(box && box.x > 20, "desktop sheet has space to its left");
    const x = box.x - 20, y = box.y + 40;
    await dialog.getByRole("heading", { name: "后台压缩", exact: true }).click();
    assert.equal(await dialog.isVisible(), true, "clicking inside keeps the sheet open");
    await page.mouse.move(box.x + 40, y);
    await page.mouse.down();
    await page.mouse.move(x, y);
    await page.mouse.up();
    assert.equal(await dialog.isVisible(), true, "dragging from inside to outside does not dismiss the sheet");
    const outsideTarget = await page.evaluateHandle(({ x, y }) => document.elementFromPoint(x, y)?.closest('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex="-1"])') ?? null, { x, y });
    await page.mouse.click(x, y);
    await dialog.waitFor({ state: "detached" });
    if (outsideTarget.asElement()) assert.ok(await outsideTarget.evaluate((el) => document.activeElement === el), "outside click preserves the clicked control's focus");
    else assert.ok(await trigger.evaluate((el) => document.activeElement === el), "outside blank click restores trigger focus");
    await outsideTarget.dispose();
  };
  const select = async (target: typeof a) => {
    await page.locator(".history-row").filter({ has: page.getByRole("button", { name: `删除会话：${target.title}`, exact: true }) }).locator("button.history-item").click();
    await page.waitForFunction((title) => document.querySelector("#chat-title")?.textContent === title, target.title);
  };
  const noRequests = () => {
    assert.equal(requests.length, 0, "opening/settings must not contact a model");
    assert.equal(commands.some((c) => c.op === "compression.start" || c.op === "prompt"), false);
  };

  await open();
  await state("idle");
  assert.equal(await dialog.getByRole("button", { name: "开始压缩", exact: true }).isDisabled(), true);
  await dialog.getByText("此会话尚无消息可压缩。", { exact: true }).waitFor();
  noRequests();
  await close();
  await select(a);
  await open();
  await expectEnabled("开始压缩");
  await dialog.getByRole("heading", { name: "使用会话模型", exact: true }).waitFor();
  assert.match(await modelDisplay.innerText(), /Chat fixture/);
  assert.equal(await dialog.locator("details.model-picker").count(), 0);
  assert.equal(server.agents.compressions.info(a), null);
  noRequests();

  // Automatic settings save individual fields, synchronize and preserve local edits.
  const tokens = dialog.getByRole("spinbutton", { name: "Token 阈值", exact: true });
  const percent = dialog.getByRole("spinbutton", { name: "上下文百分比（%）", exact: true });
  const automatic = dialog.getByRole("checkbox", { name: "启用自动压缩" });
  assert.equal(await automatic.isChecked(), true);
  await tokens.fill("80000");
  await tokens.press("Enter");
  await wait(() => server.store.compressionPreferences().auto.tokens === 80000, "token setting not saved");
  await percent.fill("101");
  await percent.press("Enter");
  await dialog.getByText("请输入 1–100 的整数，尚未保存。", { exact: true }).waitFor();
  assert.equal(server.store.compressionPreferences().auto.percent, 80);
  await percent.fill("65");
  await percent.press("Enter");
  await wait(() => server.store.compressionPreferences().auto.percent === 65, "percent setting not saved");
  await automatic.uncheck();
  await wait(() => !server.store.compressionPreferences().auto.enabled, "toggle not saved");
  const observer = await browser.newPage();
  await observer.addInitScript((view) => sessionStorage.setItem("view", JSON.stringify(view)), { workspaceId: b.workspaceId, sessionId: b.sessionId });
  await observer.goto(server.origin);
  await observer.locator('[data-od-id="background-compression-trigger"]').click();
  const observerDialog = observer.getByRole("dialog", { name: "后台压缩", exact: true });
  await observerDialog.getByRole("spinbutton", { name: "Token 阈值", exact: true }).waitFor();
  assert.equal(await observerDialog.getByRole("spinbutton", { name: "Token 阈值", exact: true }).inputValue(), "80000");
  await percent.fill("70"); // Another window must not discard this uncommitted input.
  const observerTokens = observerDialog.getByRole("spinbutton", { name: "Token 阈值", exact: true });
  await observerTokens.fill("90000");
  await observerTokens.press("Enter");
  await wait(() => server.store.compressionPreferences().auto.tokens === 90000, "other window did not save");
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>('.auto-compression-fields input')?.value === "90000");
  assert.equal(await percent.inputValue(), "70");
  await percent.press("Enter");
  await wait(() => server.store.compressionPreferences().auto.percent === 70, "local draft did not save");
  await observer.close();
  assert.deepEqual(server.store.compressionPreferences(), { auto: { enabled: false, tokens: 90000, percent: 70 } });
  await wait(() => preferenceSnapshots.some((data: any) => data?.auto?.tokens === 90000 && !Object.hasOwn(data, "selection")), "auto-only subscription was not published");
  noRequests();

  for (const [width, height] of [[390, 844], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    const box = await dialog.boundingBox();
    assert.ok(box && box.x >= -1 && box.x + box.width <= width + 1, `dialog fits ${width}px viewport`);
    assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `dialog does not overflow at ${width}px`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    mkdirSync("test-results", { recursive: true });
    await page.screenshot({ path: `test-results/compression-page-${width}.png` });
    await tokens.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/auto-compression-page-${width}.png` });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.ok(await trigger.evaluate((el) => el === document.activeElement), "one Escape closes the detail and restores trigger focus");
    await open();
  }
  await close();
  await select(b);
  await open();
  assert.match(await modelDisplay.innerText(), /Chat fixture/);
  await expectEnabled("开始压缩");
  await close();
  await page.reload();
  await page.waitForFunction((title) => document.querySelector("#chat-title")?.textContent === title, b.title);
  await open();
  assert.match(await modelDisplay.innerText(), /Chat fixture/);
  await page.waitForFunction(() => (document.querySelector('.auto-compression-field input') as HTMLInputElement | null)?.value === "90000");
  assert.equal(await automatic.isChecked(), false);
  assert.equal(await tokens.inputValue(), "90000");
  assert.equal(await percent.inputValue(), "70");
  noRequests();
  await close();
  await select(a);
  await page.locator("#prompt").fill("压缩不打扰聊天草稿");
  const original = readFileSync(a.file!, "utf8");
  await open();

  const start = async (name: string) => {
    const count = requests.length + 1;
    await expectEnabled(name);
    await dialog.getByRole("button", { name, exact: true }).click();
    await state("running");
    assert.equal(await dialog.getByRole("button", { name: "压缩进行中", exact: true }).isDisabled(), true);
    await expectEnabled("取消压缩");
    await wait(() => responses.length >= count, `native compact request ${count} did not reach loopback provider: ${JSON.stringify(server.agents.compressions.info(a))}`);
    assert.equal(requests.length, count, "one provider request per explicit start");
    assert.equal(requests[count - 1].model, chat.id);
    assert.ok(requests[count - 1].tools?.length, "summary retains tool declarations for prefix matching, without an executor");
    assert.match(JSON.stringify(requests[count - 1].messages.at(-1)?.content), /无需额外生成卡片标题或短摘要/);
    assert.deepEqual(server.agents.compressions.info(a)!.selection, chat);
    await wait(() => !server.agents.active(a), "memory preparation did not settle");
    assert.deepEqual(server.agents.info(a).selection, chat);
    return server.agents.compressions.info(a)!.id;
  };
  const first = await start("开始压缩");
  assert.match(JSON.stringify(requests[0].messages.at(-1)), /## Goal|## Original Request/);
  const currentStep = dialog.locator('.compression-steps li[data-phase="current"]');
  await currentStep.waitFor();
  assert.equal(await currentStep.count(), 1);
  assert.equal(await currentStep.getAttribute("aria-current"), "step");
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    await page.emulateMedia({ reducedMotion });
    for (const icon of [currentStep.locator(".bubble-loading"), dialog.locator(".compression-status .data-icon"), trigger.locator(".data-icon")]) {
      const frames = await icon.evaluate(node => {
        const svg = node as SVGSVGElement;
        svg.pauseAnimations();
        svg.setCurrentTime(0.2);
        const first = [...svg.querySelectorAll("circle")].map(circle => [circle.r.animVal.value, getComputedStyle(circle).opacity]);
        svg.setCurrentTime(0.7);
        const second = [...svg.querySelectorAll("circle")].map(circle => [circle.r.animVal.value, getComputedStyle(circle).opacity]);
        svg.unpauseAnimations();
        return { first, second, stroke: getComputedStyle(svg).stroke };
      });
      assert.ok([3, 8].includes(frames.first.length));
      assert.notDeepEqual(frames.first, frames.second, `compression activity animates in ${reducedMotion}`);
      if (frames.first.length === 8) assert.equal(frames.stroke, "none");
    }
  }
  await page.screenshot({ path: "test-results/compression-page-running.png" });
  await closeOutside();
  assert.equal(server.agents.compressions.info(a)!.state, "running", "outside dismissal keeps compression running");
  assert.equal(commands.filter((c) => c.op === "compression.cancel").length, 0);
  await page.locator("#prompt").focus();
  await page.locator("#prompt").evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(2, 5));
  completeSummaries = true;
  reply(responses[0]);
  await wait(() => server.agents.compressions.info(a)?.state !== "running", "first compression did not settle").catch((error) => {
    console.error("compression diagnostic", server.agents.compressions.info(a), requests);
    throw error;
  });
  assert.equal(server.agents.compressions.info(a)?.state, "completed", JSON.stringify(server.agents.compressions.info(a)));
  completeSummaries = false;
  const afterFirstCount = requests.length;
  assert.ok(requests.some(request => JSON.stringify(request.messages.at(-1)).includes("## Original Request")), "native split-turn format is preserved");
  await page.waitForSelector('[data-od-id="background-compression-trigger"][data-state="completed"]');
  // Recent archived ranges now stay expanded: a new compaction is transparent
  // in the timeline instead of forcing an old numbered card into the view.
  const archive = await server.agents.command({ ...a, requestId: randomUUID(), op: "agent.history.index", params: {} }) as HistoryIndex;
  assert.equal(archive.segments.at(-1)?.compression.number, 1);
  await page.getByText("压缩会话 A 已保存消息", { exact: true }).waitFor();
  assert.equal(await page.locator(".compaction-title").count(), 0, "native summary needs no generated short title");
  assert.equal(await trigger.locator("animate").count(), 0, "compression completion removes loading bubbles");
  assert.equal(await trigger.locator('use[href="#i-fold"]').count(), 1, "completion restores the idle fold glyph");
  await page.mouse.move(0, 0);
  await expectTriggerColor("--action-icon-fg");
  assert.equal(await dialog.count(), 0, "completion does not reopen dialog");
  assert.deepEqual(await page.locator("#prompt").evaluate((el: HTMLTextAreaElement) => [el.value, el === document.activeElement, el.selectionStart, el.selectionEnd]), ["压缩不打扰聊天草稿", true, 2, 5]);
  assert.ok(readFileSync(a.file!, "utf8").startsWith(original), "compression preserves original JSONL history");
  await open();
  await state("completed");
  await page.mouse.move(0, 0);
  await dialog.getByRole("heading", { name: "后台压缩", exact: true }).click();
  await expectTriggerColor("--action-icon-fg");
  assert.equal(await currentStep.count(), 0, "terminal stages stop animation");
  assert.equal(await dialog.locator('.compression-steps li[data-phase="done"]').count(), 3);
  await dialog.locator(".compression-summary").getByText(/浏览器真实压缩摘要/).first().waitFor();
  await dialog.getByRole("heading", { name: "Goal", exact: true }).first().waitFor();
  assert.equal(await dialog.locator(".compression-summary li strong").first().innerText(), "保留上下文");
  assert.equal(await dialog.locator(".compression-summary pre code").first().innerText(), "const compact = true;");
  assert.doesNotMatch(await dialog.locator(".compression-summary").innerText(), /axiom-summary/);
  await dialog.locator(".compression-summary").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/compression-page-summary.png" });
  assert.equal(await dialog.locator("script").count(), 0);
  assert.equal(await page.evaluate(() => (window as unknown as { __compressionInjected?: boolean }).__compressionInjected), undefined);
  assert.equal(await dialog.getByRole("button", { name: "取消压缩", exact: true }).count(), 0);
  await dialog.getByRole("button", { name: "再次压缩", exact: true }).click();
  await dialog.getByText("当前上下文已压缩，尚无新增消息可再次压缩。", { exact: true }).waitFor();
  await expectEnabled("再次压缩");
  assert.equal(requests.length, afterFirstCount, "already compacted context must not call provider again");
  // A real new chat request also refreshes the reusable provider prefix.
  await server.agents.command({ ...a, requestId: randomUUID(), op: "prompt", params: { text: "压缩后的新增请求" } });
  await wait(() => !server.agents.active(a), "new chat did not settle");
  await server.agents.releaseIdle(a);
  server.agents.refresh(a);
  const second = await start("再次压缩");
  const beforeCancel = readFileSync(a.file!, "utf8");
  assert.notEqual(second, first);
  await dialog.getByRole("button", { name: "取消压缩", exact: true }).click();
  await state("cancelled");
  await expectEnabled("再次压缩");
  await closeOutside();
  await open();
  await state("cancelled");
  assert.equal(readFileSync(a.file!, "utf8"), beforeCancel, "cancel does not append a compaction");
  const thirdResponse = responses.length;
  const third = await start("再次压缩");
  assert.notEqual(third, second);
  completeSummaries = true; // Repeated/split-turn compaction may issue another native summary call.
  reply(responses[thirdResponse]);
  await state("completed");
  await expectEnabled("再次压缩");
  const completedRequestCount = requests.length;
  await close();
  await page.reload();
  await open();
  await state("completed");
  await expectEnabled("再次压缩");
  assert.equal(server.agents.compressions.info(a)!.id, third, "reload never resubmits");
  assert.equal(requests.length, completedRequestCount);
  assert.match(await modelDisplay.innerText(), /Chat fixture/);
  for (const scope of [empty, a, b]) assert.deepEqual(server.agents.info(scope).selection, chat, "compression selection never changes chat model");
  assert.equal(commands.filter((c) => c.op === "compression.start").length, 4);

  // A provider failure must survive worker IPC, persistence, subscription and reload.
  await close();
  await select(b);
  await open();
  failSummaries = true;
  const beforeFailure = readFileSync(b.file!, "utf8");
  await dialog.getByRole("button", { name: "开始压缩", exact: true }).click();
  await state("failed");
  await dialog.getByRole("alert").getByText(/quota_exhausted/).waitFor();
  // Toolbar icons keep a neutral color; the error glyph and detail convey failure.
  await trigger.locator(".data-icon-error").waitFor();
  await expectTriggerColor("--action-icon-fg");
  assert.match(await dialog.getByRole("alert").innerText(), /失败原因/);
  assert.doesNotMatch(await dialog.innerText(), /sk-fixture-secret/);
  await page.screenshot({ path: "test-results/compression-page-failed.png" });
  assert.equal(await currentStep.count(), 0);
  assert.equal(await dialog.locator('.compression-steps li[data-phase="done"]').count(), 1);
  assert.equal(await dialog.locator('.compression-steps li[data-phase="failed"]').count(), 1);
  assert.equal(await dialog.locator('.compression-steps li[data-phase="pending"]').count(), 1);
  assert.ok(readFileSync(b.file!, "utf8").startsWith(beforeFailure), "memory preparation is append-only");
  assert.ok(!readFileSync(b.file!, "utf8").split("\n").some(line => line && JSON.parse(line).type === "compaction"), "failed compression never applies a summary");
  await expectEnabled("再次压缩");
  const failed = server.agents.compressions.info(b)!;
  assert.match(failed.error!, /quota_exhausted/);
  assert.doesNotMatch(JSON.stringify(failed), /sk-fixture-secret/);
  await close();
  await page.reload();
  await open();
  await state("failed");
  await dialog.getByRole("alert").getByText(/quota_exhausted/).waitFor();
  assert.equal(server.agents.compressions.info(b)!.id, failed.id);
  assert.equal(commands.filter((c) => c.op === "compression.cancel").length, 1);
  assert.equal(commands.some((c) => c.op === "agent.model" || c.op === "prompt"), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(nativeDialogs, []);
  assert.deepEqual(fixtureErrors, []);
  console.log("PASS: automatic compression toggle, token/percent validation and autosave, cross-window synchronization with draft preservation, reload persistence; empty/open-only compression page; read-only session model across sessions/reload; start → complete → restart → cancel → restart; real pi application; chat/draft isolation; 390/1440 layout; single Escape and focus restoration; stage animation/reduced motion; provider failure cause, redaction and reload persistence");
} finally {
  await browser?.close();
  await app?.close();
  fixture.closeAllConnections();
  await new Promise<void>((resolve) => fixture.close(() => resolve()));
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
  else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
