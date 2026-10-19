// Real source page/storage; prompt receipts and run state are controlled at the WS boundary.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Locator, type WebSocketRoute } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import { agentScope, emptyAgent, type Selection } from "../src/shared/agent.js";
import type { Command, Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-annotations-")), artifacts = resolve("test-results/reply-annotations");
mkdirSync(join(root, "pi")); mkdirSync(artifacts, { recursive: true });
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: process.env.AXIOM_TEST_BUILT !== "1" });
  const w = app.store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: root, authorized: true } }) as Workspace;
  const s = app.store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: w.id }) as Session;
  const other = app.store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: w.id }) as Session;
  const scope = { workspaceId: w.id, sessionId: s.id }, views = (app.agents as unknown as { views: AgentViews }).views;
  const source = "## 实施方案\n\n接口采用逐条提交，需要调整为批量。其他接口保持不变。\n\n超时设置为 30 秒，失败后直接重试。\n\n- 保留配置\n- 返回处理结果\n\n```ts\nconst timeout = 30;\nconst retry = true;\n```\n\n| 设置 | 值 |\n| --- | --- |\n| 重试 | 三次 |\n\n[查看文档](https://example.com)\n\n![批注图片](C:/annotation-fixture.png)\n\n### 带上间距的标题\n\n这是一段用于检查自动换行的较长正文，包含 **加粗内容** 和末尾的 `行内代码`。";
  views.messageChanged(scope, { id: "answer", role: "assistant", text: source });
  views.messageChanged(scope, { id: "stream", role: "assistant", text: "正在输出的内容", streaming: true });
  views.flush(scope);
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", permissions: ["clipboard-read", "clipboard-write"] });
  page.setDefaultTimeout(8000);
  const errors: string[] = [], commands: Command[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((value) => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  const selection: Selection = { provider: "fixture", id: "model", thinking: "off" };
  let active = false, fail = false, socket: WebSocketRoute, seq = 0, imageRequests = 0;
  const info = () => ({ ...emptyAgent, selection, run: active ? { id: "running", sessionId: s.id, status: "running", selection, startedAt: Date.now() } : null });
  const publishInfo = () => socket.send(JSON.stringify({ type: "snapshot", scope: agentScope(scope), streamId: "annotation-fixture", seq: ++seq, data: info() }));
  await page.routeWebSocket("**/ws", (route) => {
    socket = route; const server = route.connectToServer();
    route.onMessage((raw) => {
      const cmd = JSON.parse(raw.toString()) as Command;
      if (cmd.op === "prompt") {
        commands.push(cmd);
        route.send(JSON.stringify(fail ? { type: "receipt", requestId: cmd.requestId, ok: false, error: { code: "TEST_FAILURE", message: "批注发送测试失败" } } :
          { type: "receipt", requestId: cmd.requestId, ok: true, data: active ? { inputId: cmd.requestId } : { runId: cmd.requestId } }));
      } else if (cmd.op === "files.markdownImage") {
        imageRequests++;
        route.send(JSON.stringify({ type: "receipt", requestId: cmd.requestId, ok: true, data: {
          id: "picture", name: "fixture.png", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6nWQAAAAASUVORK5CYII=",
        } }));
      } else if (cmd.op === "subscribe" && cmd.params?.scope === agentScope(scope)) {
        publishInfo(); route.send(JSON.stringify({ type: "receipt", requestId: cmd.requestId, ok: true, data: {} }));
      } else server.send(raw);
    });
    server.onMessage((raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "snapshot" && msg.scope === agentScope(scope)) return;
      if (msg.type === "snapshot" && msg.scope === "configuration") msg.data.available = [{ ...selection, name: "Fixture", input: ["text"] }];
      route.send(JSON.stringify(msg));
    });
  });
  const clickText = async (locator: Locator, fragment: string) => {
    await locator.scrollIntoViewIfNeeded();
    const point = await locator.evaluate((el, text) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const start = node.textContent!.indexOf(text);
        if (start < 0) continue;
        const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + text.length);
        const rect = range.getBoundingClientRect(); return { x: rect.left + 2, y: rect.top + rect.height / 2 };
      }
      throw new Error(`Missing detail: ${text}`);
    }, fragment);
    await page.mouse.click(point.x, point.y);
  };
  await page.goto(app.origin);
  const toggle = page.locator(".annotation-toggle"), reply = page.getByRole("article", { name: "助手回复" }).first();
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator(".annotation-tray,.annotation-block").count(), 0);
  const position = await page.locator(".usage-settings > button").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")));
  assert.deepEqual(position.slice(0, 3), ["开启批注", "原始会话", "子代理设置"]);
  await page.locator("#prompt").fill("保留输入框里的草稿");
  // Switching mode must preserve mounted image/code state, not refetch/recreate it.
  await reply.locator(".markdown-image").scrollIntoViewIfNeeded();
  const image = reply.locator(".markdown-image img"); await image.waitFor();
  await image.evaluate((el) => { (window as any).annotationImageNode = el; });
  await reply.getByRole("button", { name: "复制代码", exact: true }).click();
  await toggle.click(); await toggle.click(); await toggle.click();
  assert.ok(await image.evaluate((el) => el === (window as any).annotationImageNode));
  assert.equal(imageRequests, 1, "mode toggling must not request the same image again");
  assert.equal(await reply.locator('.code-head button[data-tooltip="已复制"]').count(), 1);
  await page.getByText("点击具体句子或选中几个字，添加批注", { exact: true }).waitFor();
  assert.equal(await page.getByRole("article", { name: "助手回复" }).last().locator(".annotation-block").count(), 0);
  // Unsupported cross-paragraph and cross-message selections must never become a different quote.
  for (const crossMessage of [false, true]) {
    await reply.evaluate((el, across) => {
      const paragraphs = el.querySelectorAll(".annotation-source p");
      const start = document.createTreeWalker(paragraphs[0], NodeFilter.SHOW_TEXT).nextNode()!;
      const endRoot = across ? document.querySelectorAll('[aria-label="助手回复"]')[1].querySelector(".annotation-source")! : paragraphs[1];
      const end = document.createTreeWalker(endRoot, NodeFilter.SHOW_TEXT).nextNode()!;
      const range = document.createRange(); range.setStart(start, 2); range.setEnd(end, 3);
      const selected = getSelection()!; selected.removeAllRanges(); selected.addRange(range);
    }, crossMessage);
    await reply.getByRole("button", { name: "批注选中文字或这一句", exact: true }).first().click();
    await page.getByText("选区跨越了不同段落或回复，请缩小选区后再批注。", { exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "批注意见", exact: true }).count(), 0);
    await page.evaluate(() => getSelection()?.removeAllRanges());
  }
  // Sentence, individual list item, table cell and code line must never quote their whole enclosing block.
  for (const [selector, fragment, expected] of [
    [".annotation-source p", "其他接口保持不变", "其他接口保持不变。"],
    [".annotation-source li", "保留配置", "保留配置"],
    [".annotation-source td", "三次", "三次"],
    [".annotation-source pre", "retry", "const retry = true;"],
  ]) {
    await clickText(reply.locator(selector).filter({ hasText: fragment }).first(), fragment);
    await page.getByRole("textbox", { name: "批注意见", exact: true }).waitFor();
    assert.equal(await page.locator(".annotation-popover .annotation-quote").innerText(), expected);
    assert.ok(await page.getByRole("textbox", { name: "批注意见", exact: true }).evaluate((el) => document.activeElement === el));
    await page.getByRole("button", { name: "取消", exact: true }).click();
  }
  const first = reply.locator(".annotation-block").filter({ hasText: "接口采用逐条提交" });
  // Check the visible SVG, not the larger click target: top at text top, bottom at its midpoint.
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [selector, fragment] of [
      ["p", "接口采用逐条提交"], ["h2", "实施方案"], ["h3", "带上间距的标题"],
      ["li", "返回处理结果"], ["td", "三次"], ["pre code", "const retry"], ["p", "检查自动换行"],
    ]) {
      const target = reply.locator(`.annotation-source ${selector}`).filter({ hasText: fragment }).first();
      await target.scrollIntoViewIfNeeded();
      const point = await target.evaluate((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let current: Node | null, node: Node = el;
        while ((current = walker.nextNode())) if (current.textContent?.trim()) node = current;
        const end = node.textContent!.trimEnd().length;
        const range = document.createRange(); range.setStart(node, end - 1); range.setEnd(node, end);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });
      await page.mouse.move(point.x, point.y);
      await page.waitForFunction((el) => {
        const walker = document.createTreeWalker(el!, NodeFilter.SHOW_TEXT);
        let current: Node | null, node: Node = el!;
        while ((current = walker.nextNode())) if (current.textContent?.trim()) node = current;
        const end = node.textContent!.trimEnd().length;
        const range = document.createRange(); range.setStart(node, end - 1); range.setEnd(node, end);
        const text = range.getBoundingClientRect(), button = el!.closest(".annotation-block")!.querySelector(".annotation-add")!;
        const hit = button.getBoundingClientRect(), icon = button.querySelector("svg")!.getBoundingClientRect();
        return Math.abs(icon.top - text.top) < 1 && Math.abs(icon.bottom - (text.top + text.height / 2)) < 1 &&
          icon.left >= text.right && hit.width >= 24 && hit.height >= 24 && hit.right <= innerWidth;
      }, await target.elementHandle());
    }
    await first.scrollIntoViewIfNeeded();
    await first.locator("p").hover();
    const appearance = await first.locator(".annotation-add").evaluate((el) => ({
      border: getComputedStyle(el).borderWidth, background: getComputedStyle(el).backgroundColor,
      visiblePaths: [...el.querySelectorAll("path")].filter((path) => getComputedStyle(path).stroke !== "none").length,
    }));
    assert.deepEqual(appearance, { border: "0px", background: "rgba(0, 0, 0, 0)", visiblePaths: 2 });
    await first.screenshot({ path: join(artifacts, `inline-icon-${width}.png`) });
  }
  await clickText(first.locator(".annotation-source"), "接口采用逐条提交");
  await page.getByRole("textbox", { name: "批注意见", exact: true }).waitFor();
  assert.equal(await page.locator(".annotation-popover .annotation-quote").innerText(), "接口采用逐条提交，需要调整为批量。");
  await page.getByRole("textbox", { name: "批注意见", exact: true }).fill("改成批量接口，并保留兼容性。");
  // Composition Enter must not save; ordinary Enter remains a newline.
  await page.getByRole("textbox", { name: "批注意见", exact: true }).dispatchEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true });
  assert.equal(await page.getByRole("button", { name: "保存批注", exact: true }).count(), 1);
  await page.getByRole("button", { name: "保存批注", exact: true }).click();
  await page.getByText("待发送批注 1 条", { exact: true }).waitFor();
  const second = reply.locator(".annotation-block").filter({ hasText: "超时设置为 30 秒" });
  await second.scrollIntoViewIfNeeded();
  const selectedRect = await second.locator(".annotation-source p").evaluate((el) => {
    const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode()!;
    const range = document.createRange(); range.setStart(text, 6); range.setEnd(text, 8);
    const rect = range.getBoundingClientRect(); return { x: rect.left, y: rect.top + rect.height / 2, width: rect.width };
  });
  await page.mouse.move(selectedRect.x, selectedRect.y); await page.mouse.down();
  await page.mouse.move(selectedRect.x + selectedRect.width, selectedRect.y, { steps: 5 }); await page.mouse.up();
  await page.getByRole("textbox", { name: "批注意见", exact: true }).waitFor();
  assert.equal(await page.locator(".annotation-popover .annotation-quote").innerText(), "30");
  await page.getByRole("textbox", { name: "批注意见", exact: true }).fill("缩短到 10 秒。");
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(() => { const rect = document.querySelector(".annotation-popover")!.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight; });
    await page.screenshot({ path: join(artifacts, `detail-editor-${width}.png`) });
  }
  await page.getByRole("textbox", { name: "批注意见", exact: true }).press("Control+Enter");
  await page.getByText("待发送批注 2 条", { exact: true }).waitFor();
  const supplement = page.getByRole("textbox", { name: "批注补充说明", exact: true });
  await supplement.fill("请先解释整体修改思路，再逐条处理。");
  await supplement.press("Enter");
  await supplement.press("End");
  await supplement.pressSequentially("Keep compatibility.");
  const supplementText = await supplement.inputValue();
  assert.equal(commands.length, 0, "supplement Enter adds a newline without sending");
  assert.ok(await page.evaluate(() => [...CSS.highlights.get("reply-annotation")!].some((range) => range.toString() === "30")));
  await toggle.click();
  assert.equal(await page.locator(".annotation-tray,.annotation-block").count(), 0);
  assert.equal(await toggle.locator(".annotation-count").innerText(), "2");
  await toggle.click();
  assert.equal(await supplement.inputValue(), supplementText);
  await page.getByRole("button", { name: "查看全部", exact: true }).click();
  await page.getByRole("button", { name: "修改批注 2", exact: true }).click();
  await page.getByRole("textbox", { name: "批注意见", exact: true }).fill("缩短到 10 秒，解释重试策略。");
  await page.getByRole("button", { name: "保存批注", exact: true }).click();
  // Pending editor text survives closing mode and session navigation.
  await first.locator(".annotation-source").click();
  await page.getByRole("textbox", { name: "批注意见", exact: true }).fill("尚未保存的批注");
  await toggle.click(); await toggle.click();
  assert.equal(await page.getByRole("textbox", { name: "批注意见", exact: true }).inputValue(), "尚未保存的批注");
  await page.locator(`.history-row[data-session-id="${other.id}"] .history-item`).click();
  await page.locator(`.history-row[data-session-id="${other.id}"] .history-item[aria-current="true"]`).waitFor();
  assert.equal(await toggle.getAttribute("aria-pressed"), "false");
  assert.equal(await page.locator("#prompt").inputValue(), "");
  await toggle.click();
  assert.equal(await supplement.inputValue(), "");
  await toggle.click();
  await page.locator(`.history-row[data-session-id="${s.id}"] .history-item`).click();
  await page.locator(`.history-row[data-session-id="${s.id}"] .history-item[aria-current="true"]`).waitFor();
  assert.equal(await supplement.inputValue(), supplementText);
  assert.equal(await page.getByRole("textbox", { name: "批注意见", exact: true }).inputValue(), "尚未保存的批注");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await first.locator(".annotation-source").click();
  await page.getByRole("textbox", { name: "批注意见", exact: true }).fill("待删除的批注");
  await page.getByRole("button", { name: "保存批注", exact: true }).click();
  await page.getByRole("button", { name: "删除批注 3", exact: true }).click();
  await page.getByText("待发送批注 2 条", { exact: true }).waitFor();
  // Code copy is still an action, and changing its label must not move saved code-line highlights.
  await clickText(reply.locator(".annotation-source pre"), "retry");
  await page.getByRole("textbox", { name: "批注意见", exact: true }).fill("检查这一行的重试开关");
  await page.getByRole("button", { name: "保存批注", exact: true }).click();
  await reply.getByRole("button", { name: "复制代码", exact: true }).click();
  assert.ok(await page.evaluate(() => [...CSS.highlights.get("reply-annotation")!].some((range) => range.toString() === "const retry = true;")));
  await page.getByRole("button", { name: "删除批注 3", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "批注意见", exact: true }).count(), 0);
  for (const [width, height] of [[360,800], [390,844], [430,932], [600,960], [820,1180], [1024,768], [1366,768], [1440,900], [1920,1080]]) {
    await page.setViewportSize({ width, height });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no overflow at ${width}`);
    if ([390, 1440].includes(width)) await page.screenshot({ path: join(artifacts, `annotations-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await supplement.fill("补".repeat(12000));
  await page.getByRole("alert").filter({ hasText: "原文、批注与补充说明合计超过" }).waitFor();
  assert.ok(await page.getByRole("button", { name: "发送批注", exact: true }).isDisabled());
  assert.equal(commands.length, 0);
  await supplement.fill(supplementText);
  await page.getByRole("button", { name: "发送批注", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".annotation-count"));
  assert.equal(commands.length, 1);
  assert.equal(commands[0].workspaceId, scope.workspaceId); assert.equal(commands[0].sessionId, scope.sessionId);
  assert.ok(String(commands[0].params?.text).includes("批注 2"));
  assert.ok(String(commands[0].params?.text).includes("解释重试策略"));
  assert.ok(String(commands[0].params?.text).includes('回复 "answer"'));
  assert.ok(String(commands[0].params?.text).endsWith(`补充说明：\n${supplementText.trim()}`));
  assert.equal(await supplement.inputValue(), "");
  assert.equal(commands[0].params?.mode, undefined);
  assert.equal(await page.locator("#prompt").inputValue(), "保留输入框里的草稿");
  active = true; publishInfo();
  await page.getByRole("button", { name: "停止执行", exact: true }).waitFor();
  await first.locator(".annotation-source").click();
  await page.getByRole("textbox", { name: "批注意见", exact: true }).fill("运行时补充意见");
  await page.getByRole("button", { name: "保存批注", exact: true }).click();
  await supplement.fill("运行期间也附上整体要求");
  await page.getByRole("button", { name: "发送批注", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".annotation-count"));
  assert.equal(commands.length, 2); assert.equal(commands[1].params?.mode, "steer");
  assert.ok(String(commands[1].params?.text).includes("补充说明：\n运行期间也附上整体要求"));
  active = false; fail = true; publishInfo();
  await page.getByRole("button", { name: "发送消息", exact: true }).waitFor();
  await first.locator(".annotation-source").click();
  await page.getByRole("textbox", { name: "批注意见", exact: true }).fill("发送失败的意见不能丢失");
  await page.getByRole("button", { name: "保存批注", exact: true }).click();
  await supplement.fill("发送失败时补充说明也不能丢失");
  await page.getByRole("button", { name: "发送批注", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "批注发送测试失败" }).waitFor();
  assert.equal(await page.locator("#prompt").inputValue(), "保留输入框里的草稿");
  assert.equal(await page.locator(".user-text").filter({ hasText: "发送失败的意见不能丢失" }).count(), 1);
  assert.equal(await page.locator(".user-text").filter({ hasText: "发送失败时补充说明也不能丢失" }).count(), 1);
  assert.equal(commands.length, 3, "failures must not auto-resend");
  // Failed annotations remain separate even when merging them would exceed the limit.
  const longDraft = "原稿".repeat(5500), longComment = "意见".repeat(950);
  await page.locator("#prompt").fill(longDraft);
  await clickText(first.locator(".annotation-source"), "接口采用逐条提交");
  await page.getByRole("textbox", { name: "批注意见", exact: true }).fill(longComment);
  await page.getByRole("button", { name: "保存批注", exact: true }).click();
  await page.getByRole("button", { name: "发送批注", exact: true }).click();
  await page.locator(".user-text").filter({ hasText: longComment }).waitFor();
  assert.equal(await page.locator("#prompt").inputValue(), longDraft);
  assert.ok(await page.getByRole("button", { name: "发送消息", exact: true }).isEnabled());
  // Restored drafts can exceed the native typing limit; exercise the send guard
  // without letting textarea.maxLength truncate this recovery fixture.
  await page.locator("#prompt").evaluate((node, value) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  }, longDraft + longComment);
  assert.equal(await page.locator("#prompt").inputValue(), longDraft + longComment);
  await page.getByRole("status").filter({ hasText: "超过 12,000 字上限" }).waitFor();
  const complete = await page.locator("#prompt").inputValue();
  assert.ok(complete.includes(longDraft) && complete.includes(longComment));
  assert.ok(await page.getByRole("button", { name: "发送消息", exact: true }).isDisabled());
  await page.locator("#prompt").press("Enter");
  assert.equal(commands.length, 4, "an over-limit draft must not create another request");
  assert.equal(await page.locator("#prompt").inputValue(), complete);
  await page.locator("#prompt").fill("已缩短的内容");
  assert.ok(await page.getByRole("button", { name: "发送消息", exact: true }).isEnabled());
  assert.equal(await page.getByText(/超过 12,000 字上限/).count(), 0);
  if (process.env.AXIOM_TEST_BUILT !== "1") {
    for (let i = 0; i < 40; i++) views.messageChanged(scope, { id: `long-${i}`, role: "assistant", text: Array.from({ length: 12 }, (_, j) => `长回复 ${i}，第 ${j} 段。正文保持稳定，批注输入不能重新解析整篇会话。`).join("\n\n") });
    views.flush(scope);
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="助手回复"]').length >= 42);
    await clickText(first.locator(".annotation-source"), "接口采用逐条提交");
    await page.getByRole("textbox", { name: "批注意见", exact: true }).waitFor();
    const modulePath = `/@fs/${resolve("src/shared/markdown.ts").replaceAll("\\", "/")}`;
    await page.evaluate(async (path) => {
      const { markdown } = await import(/* @vite-ignore */ path);
      const original = markdown.lexer;
      (window as any).annotationLexerCalls = 0;
      markdown.lexer = function (...args: any[]) { (window as any).annotationLexerCalls++; return original.apply(this, args); };
      (window as any).restoreAnnotationLexer = () => { markdown.lexer = original; };
    }, modulePath);
    await page.getByRole("textbox", { name: "批注意见", exact: true }).pressSequentially("Only this comment should update.");
    assert.equal(await page.evaluate(() => (window as any).annotationLexerCalls), 0, "typing must not reparse any reply in a long conversation");
    await page.evaluate(() => (window as any).restoreAnnotationLexer());
    await page.getByRole("button", { name: "取消", exact: true }).click();
  }
  assert.deepEqual(errors, []);
  console.log("PASS: stable image/code state across mode switches, rejected cross-block/message selections, " +
    (process.env.AXIOM_TEST_BUILT === "1" ? "" : "isolated typing in long conversations, ") + "toolbar position, opt-in mode, streaming exclusion, paragraph/sentence/list item/table cell/code line/selection comments, exact code highlight after copy, IME, edit/delete, close/reopen and session navigation with pending editor, code copy, nine viewports, idle/steering batch payload, input preservation, failure recovery and lossless over-limit blocking");
} finally {
  await browser?.close(); await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
