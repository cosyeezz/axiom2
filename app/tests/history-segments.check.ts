import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-segment-ui-"));
const artifacts = process.env.AXIOM_HISTORY_ARTIFACTS ?? join(root, "artifacts"); mkdirSync(artifacts, { recursive: true });
mkdirSync(join(root, "project")); mkdirSync(join(root, "pi"));
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  app = await startServer({ root, port: 0, dev: true });
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "project"), authorized: true } }) as Workspace;
  const create = (title: string) => app!.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id, params: { title } }) as Session;
  const first = create("分段历史设计验收"), long = create("长历史窗口验收"), plain = create("独立会话");
  const assistant = (text: string, more: any = {}) => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop", timestamp: 1, ...more }) as any;
  const make = (session: Session, count: number, turns: number) => {
    const manager = SessionManager.create(join(root, "project"), join(root, `native-${session.id}`));
    const compressions: string[] = [], users: string[] = [], calls: string[] = [], deliveries: { id: string; text: string }[] = [];
    for (let segment = 1; segment <= count; segment++) {
      for (let turn = 0; turn < turns; turn++) {
        users.push(manager.appendMessage({ role: "user", content: `第 ${segment} 段 · 问题 ${turn + 1}：请检查历史展示和阅读体验`, timestamp: 1 }));
        const interrupted = session.id === first.id && segment === 1 && turn === 0;
        if (interrupted) manager.appendMessage(assistant("过程前未标交付的说明", { stopReason: "toolUse" }));
        if (turn === 0) {
          calls.push(manager.appendMessage(assistant("", { content: [{ type: "thinking", thinking: "核对分段边界与完整工具记录。" }, { type: "toolCall", id: `read-${segment}`, name: "read", arguments: { path: `segment-${segment}.ts` } }], stopReason: "toolUse" })));
          manager.appendMessage({ role: "toolResult", toolCallId: `read-${segment}`, toolName: "read", content: [{ type: "text", text: "工具输出正文\n" + "完整工具内容 ".repeat(2200) + `工具末尾-${segment}` }], isError: false, timestamp: 1 });
        }
        if (segment === 2 && turn === 0) manager.appendMessage(assistant("执行过程中的说明保留在绿色卡里面。", {
          content: [{ type: "text", text: "执行过程中的说明保留在绿色卡里面。", textSignature: JSON.stringify({ v: 1, id: "narration", phase: "commentary" }) }],
        }));
        // An interrupted turn has no final_answer; only its tools may disclose locally.
        if (interrupted) {
          manager.appendMessage(assistant("过程后未标交付的说明", { stopReason: "toolUse" }));
          continue;
        }
        const text = `第 ${segment} 段回复 ${turn + 1}：\n\n已保留完整会话，压缩只影响模型上下文，不影响对话历史。\n\n- 原文与压缩信息独立展开\n- 连续滚动，不使用分页\n- 工具详情按需读取${turn % 3 === 0 ? "\n\n```ts\nconst history = { lazy: true, preserveReading: true };\n```" : ""}`;
        const id = manager.appendMessage(assistant(text, segment === 2 ? {
          content: [{ type: "text", text, textSignature: JSON.stringify({ v: 1, id: `delivery-${turn}`, phase: "final_answer" }) }],
        } : {}));
        deliveries.push({ id, text });
      }
      compressions.push(manager.appendCompaction(`<axiom-summary>不应显示的旧短标题</axiom-summary>\n\n## 第 ${segment} 次压缩信息\n\n这里保留完整的交接摘要，与原文可以同时查看。`, null, 24000 + segment * 1000));
    }
    manager.appendMessage({ role: "user", content: "最新压缩点之后的当前问题", timestamp: 1 });
    manager.appendMessage(assistant("当前对话始终可见。"));
    app!.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(session.id, manager.getSessionFile()!);
    return { manager, compressions, users, calls, deliveries };
  };
  const fixture = make(first, 5, 2), longFixture = make(long, 4, 200);
  const scope = { workspaceId: workspace.id, sessionId: first.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const file = fixture.manager.getSessionFile()!, before = readFileSync(file, "utf8");
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"], reducedMotion: "reduce" }); page.setDefaultTimeout(15000);
  // Concurrent work may edit unrelated client modules. Keep this isolated run on its loaded snapshot.
  await page.route("**/@vite/client", async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace("async function handleMessage(payload) {", "async function handleMessage(payload) { return;");
    await route.fulfill({ response, body });
  });
  const errors: string[] = [], operations: { op: string; params?: any }[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("websocket", socket => socket.on("framesent", ({ payload }) => { const frame = JSON.parse(String(payload)); if (frame.op) operations.push(frame); }));
  await page.addInitScript(value => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  const settle = async () => { await page.waitForTimeout(250); await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))); };
  // Navigation arrows now step through deliveries. These helpers only prepare
  // history test positions; they are not assertions about arrow destinations.
  const boundary = async (end: boolean) => {
    await page.locator("#thread").dispatchEvent("wheel", { deltaY: -1 });
    await page.locator("#thread").evaluate((node, end) => { node.scrollTop = end ? node.scrollHeight : 0; }, end);
    await settle();
  };
  const top = () => boundary(false), bottom = () => boundary(true);
  const card = (id: string) => page.locator(`[data-compaction-id="${id}"]`);
  const originals = (id: string) => card(id).getByRole("button", { name: "展开会话原文", exact: true });
  await page.getByText("当前对话始终可见。", { exact: true }).waitFor(); await settle();
  assert.equal(await page.getByRole("button", { name: "原始会话", exact: true }).count(), 0);
  assert.ok(operations.some(command => command.op === "agent.history.index"));
  assert.ok(!operations.some(command => command.op === "agent.original" || command.op === "prompt"));
  await page.locator("#prompt").fill("保留草稿，不得发送");
  await top();
  assert.equal(await originals(fixture.compressions[0]).getAttribute("aria-expanded"), "false");
  assert.equal(await originals(fixture.compressions[1]).getAttribute("aria-expanded"), "false");
  assert.ok(!operations.some(command => command.op === "agent.history.read" && command.params.segmentId === fixture.compressions[0]));
  assert.equal(await card(fixture.compressions[0]).locator(".compaction-title").count(), 0);
  const summary = card(fixture.compressions[0]).getByRole("button", { name: "查看压缩信息", exact: true });
  await summary.click(); await page.getByText("这里保留完整的交接摘要，与原文可以同时查看。", { exact: true }).waitFor();
  assert.equal(await originals(fixture.compressions[0]).getAttribute("aria-expanded"), "false");
  assert.equal(await page.getByText("不应显示的旧短标题", { exact: true }).count(), 0);
  await originals(fixture.compressions[0]).click(); await top();
  await page.getByText("第 1 段 · 问题 1：请检查历史展示和阅读体验", { exact: true }).waitFor();
  assert.equal(await card(fixture.compressions[0]).count(), 0, "an expanded checkpoint has no card or summary placeholder");
  assert.equal(await page.locator(".history-range-row").count(), 0, "expanded originals have no range rail");
  const archived = page.locator(".archived-process").first();
  const interruptedKey = views.historyIndex(scope).segments[0].groups.find(group => group.ids.includes(fixture.calls[0]))!.id;
  assert.equal(await archived.locator("xpath=..").getAttribute("data-timeline-key"), `archive:${fixture.compressions[0]}:${interruptedKey}`);
  assert.equal(await archived.getAttribute("open"), null);
  assert.ok((await archived.getAttribute("class"))?.includes("process-live"), "interrupted tools get only a local disclosure");
  assert.equal(await archived.locator(":scope > summary .activity-status-completed").count(), 0);
  assert.equal(await page.getByText("过程前未标交付的说明", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("过程后未标交付的说明", { exact: true }).isVisible(), true);
  assert.equal(await archived.locator(".tool-call").count(), 0, "closed interrupted history does not mount tool rows");
  assert.ok(!operations.some(command => command.op === "agent.history.read" && command.params.groupId === interruptedKey), "folded process internals are not fetched");
  await archived.locator(":scope > summary").click();
  assert.equal(await archived.getByText("过程前未标交付的说明", { exact: true }).count(), 0, "narration is not inside the local tool disclosure");
  assert.equal(await archived.locator(".activity.process-live").count(), 0, "there is no duplicate inner disclosure");
  const tool = archived.locator(".tool-call").first(); await tool.waitFor(); await tool.locator(":scope > summary").click();
  await page.getByText(/工具末尾-1/).waitFor();
  assert.equal(await page.locator("#prompt").inputValue(), "保留草稿，不得发送");
  await tool.scrollIntoViewIfNeeded(); await settle();
  await page.screenshot({ path: join(artifacts, "desktop-tool.png") });
  await bottom(); await top(); await page.getByText(/工具末尾-1/).waitFor();
  assert.equal(await tool.getAttribute("open"), "", "tool disclosure survives window recycling");
  await archived.locator(":scope > summary").click(); await settle();
  await top();
  assert.equal(await card(fixture.compressions[1]).count(), 0, "opening the first range also removes all later expanded cards");
  await top();
  const finalKey = `final-process:${fixture.calls[1]}`;
  const finalRow = page.locator(`[data-timeline-key="archive:${fixture.compressions[1]}:${finalKey}"]`);
  for (let i = 0; i < 25 && !await finalRow.count(); i++) { await page.locator("#thread").evaluate(n => { n.scrollTop += 400; }); await settle(); }
  const finalCard = finalRow.locator(".archived-process");
  await finalCard.waitFor();
  assert.ok(!(await finalCard.getAttribute("class"))?.includes("process-live"));
  assert.equal(await finalCard.locator(":scope > summary .activity-status-completed").count(), 1);
  assert.equal(await finalCard.locator("animate").count(), 0, "history mounts do not replay live completion animation");
  assert.equal(await finalCard.locator(".tool-call").count(), 0);
  assert.ok(!operations.some(command => command.op === "agent.history.read" && command.params.groupId === finalKey), "final card does not prefetch its bodies");
  const delivery = fixture.deliveries.find(item => item.text.startsWith("第 2 段回复 1："))!;
  // Delivery rows keep one key across live and archive storage (message:<id>), so the anchor survives compaction.
  const deliveryKey = `message:${delivery.id}`;
  const deliveryRow = page.locator(`[data-timeline-key="${deliveryKey}"]`);
  const assertDeliveryActions = async () => {
    await deliveryRow.scrollIntoViewIfNeeded(); await settle();
    const copy = deliveryRow.getByRole("button", { name: "复制回复的 Markdown 原文" });
    const fork = deliveryRow.getByRole("button", { name: "从此处创建分支" });
    assert.equal(await copy.count(), 1, "archived delivery restores the copy action from final_answer");
    assert.equal(await fork.count(), 1, "archived delivery restores the Fork action");
    assert.equal(await fork.isEnabled(), true);
    await copy.focus(); await copy.click();
    await page.waitForFunction(id => document.querySelector(`[data-timeline-key="${id}"] .reply-actions`)?.getAttribute("data-feedback") === "copied", deliveryKey);
    assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n"), delivery.text, "history copies original Markdown, not the summary");
  };
  await assertDeliveryActions();
  const fork = deliveryRow.getByRole("button", { name: "从此处创建分支" });
  await fork.focus(); await fork.click();
  const forkDialog = page.getByRole("dialog", { name: "创建分支会话" });
  await forkDialog.getByRole("button", { name: "仅创建", exact: true }).click();
  await forkDialog.waitFor({ state: "detached" });
  assert.ok(operations.some(command => command.op === "agent.fork" && command.params.messageId === delivery.id), "Fork targets the archived delivery ID");
  const branch = app.store.db.prepare("SELECT a.file FROM agent_sessions a JOIN sessions s ON s.id=a.sessionId WHERE s.forkParentSessionId=?").get(first.id)!;
  const branchManager = SessionManager.open(String(branch.file));
  assert.equal(branchManager.getBranch().filter(entry => entry.type === "message").at(-1)?.id, delivery.id, "Fork ends at the original historical delivery, not the current tail");
  assert.equal(await page.locator("#prompt").inputValue(), "保留草稿，不得发送");
  await finalCard.scrollIntoViewIfNeeded();
  await finalCard.locator(":scope > summary").click();
  await finalCard.getByText("执行过程中的说明保留在绿色卡里面。", { exact: true }).waitFor();
  assert.equal(await finalCard.locator(".reply-actions").count(), 0, "process commentary never inherits delivery actions");
  const inner = finalCard.locator(".activity.process-live").first(); await inner.waitFor();
  assert.equal(await inner.getAttribute("open"), null, "original inner gray process remains closed inside the delivery card");
  assert.equal(await finalCard.locator(".tool-call").count(), 0);
  await inner.locator(":scope > summary").click(); await finalCard.locator(".tool-call").first().waitFor();
  assert.equal(await finalCard.locator(".archived-process").count(), 0, "no extra archive card is nested");
  await finalCard.scrollIntoViewIfNeeded(); await settle();
  await page.screenshot({ path: join(artifacts, "desktop-final-original-hierarchy.png") });
  await finalCard.locator(":scope > summary").click(); await top();
  assert.equal(await page.locator(".history-range-controls,.history-range-collapse").count(), 0, "expanded history exposes no collapse button");
  await page.reload(); await page.getByText("当前对话始终可见。", { exact: true }).waitFor(); await settle(); await top();
  assert.equal(await card(fixture.compressions[0]).count(), 0, "existing expansion cache still survives view reload");
  for (let i = 0; i < 25 && !await deliveryRow.count(); i++) { await page.locator("#thread").evaluate(n => { n.scrollTop += 400; }); await settle(); }
  await assertDeliveryActions();
  await deliveryRow.getByRole("button", { name: "从此处创建分支" }).focus();
  await page.screenshot({ path: join(artifacts, "archived-delivery-actions.png") });
  for (const [width, height] of [[1440, 1000], [820, 900], [390, 844], [390, 480]]) {
    await page.setViewportSize({ width, height });
    const expand = page.getByRole("button", { name: "展开工作台", exact: true }); if (await expand.isVisible()) await expand.click();
    await top();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no horizontal overflow ${width}`);
    const overlap = await page.evaluate(() => {
      const nav = document.querySelector(".thread-navigation")!.getBoundingClientRect();
      const thread = document.querySelector("#thread")!.getBoundingClientRect();
      // Windowed rows outside the scrollport are clipped, not painted over the mobile footer.
      return [...document.querySelectorAll(".history-card button")].some(button => {
        const rect = button.getBoundingClientRect();
        const top = Math.max(rect.top, thread.top), bottom = Math.min(rect.bottom, thread.bottom);
        return bottom > top && bottom > nav.top && top < nav.bottom && rect.right > nav.left && rect.left < nav.right;
      });
    });
    assert.equal(overlap, false, `card controls do not overlap navigation ${width}`);
    await page.screenshot({ path: join(artifacts, `layout-${width}-${height}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await top();
  const choices = () => page.evaluate(scope => JSON.parse(sessionStorage.getItem(`axiom:history-ranges:${scope.workspaceId}:${scope.sessionId}`) ?? "{}"), scope);
  const opened = await choices();
  assert.deepEqual(fixture.compressions.map(id => opened[id]), [true, true, true, true, true], "all manually opened ranges remain open");
  const mountedKeys = await page.locator("[data-timeline-key]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-timeline-key")));
  assert.equal(new Set(mountedKeys).size, mountedKeys.length, "live/archive keys are unique");
  await page.locator(`[data-session-id="${long.id}"] button.history-item`).click();
  await page.getByText("当前对话始终可见。", { exact: true }).waitFor(); await settle();
  const total = Number(await page.locator(".virtual-timeline").getAttribute("data-total-rows")); assert.ok(total > 1000);
  const maximum: number[] = [];
  await top();
  const old = card(longFixture.compressions[0]); await old.waitFor();
  assert.equal(await originals(longFixture.compressions[0]).getAttribute("aria-expanded"), "false");
  // Traverse continuously through multiple windows; no button/page boundary interrupts scrolling.
  for (let i = 0; i < 16; i++) {
    await page.locator("#thread").evaluate(node => { node.scrollTop += node.clientHeight * 2; }); await settle();
    maximum.push(await page.locator("[data-timeline-key]").count());
  }
  assert.ok(Math.max(...maximum) < 100, `mounted rows bounded: ${Math.max(...maximum)} of ${total}`);
  const anchor = async () => page.locator("#thread").evaluate(node => {
    const top = node.getBoundingClientRect().top;
    const visible = [...node.querySelectorAll<HTMLElement>("[data-timeline-key]")].find(row => row.getBoundingClientRect().bottom > top + 10);
    return visible ? { key: visible.dataset.timelineKey!, offset: visible.getBoundingClientRect().top - top } : null;
  });
  const saved = await anchor(); assert.ok(saved);
  const longChoices = () => page.evaluate(scope => JSON.parse(sessionStorage.getItem(`axiom:history-ranges:${scope.workspaceId}:${scope.sessionId}`) ?? "{}"), { workspaceId: workspace.id, sessionId: long.id });
  const beforeBatch = await longChoices();
  for (let i = 0; i < 4; i++) longFixture.manager.appendCompaction(`## 新压缩信息 ${i}\n不会强制收起正在阅读的区间。`, null, 30000);
  views.refresh({ workspaceId: workspace.id, sessionId: long.id }); await settle(); await settle();
  const afterBatch = await longChoices();
  for (const id of longFixture.compressions) assert.equal(afterBatch[id], beforeBatch[id], "batched compactions preserve existing expansion, including default reading state");
  assert.equal(Object.values(afterBatch).filter(Boolean).length, Object.values(beforeBatch).filter(Boolean).length + 4, "all four appended ranges open without closing reading");
  const after = await anchor(); assert.equal(after?.key, saved.key); assert.ok(Math.abs(after!.offset - saved.offset) <= 3, `new compaction anchor drift ${after!.offset - saved.offset}px`);
  await page.screenshot({ path: join(artifacts, "long-history-reading.png") });
  await page.setViewportSize({ width: 1200, height: 1000 }); await settle(); await settle();
  assert.equal((await anchor())?.key, after?.key, "width reflow keeps the logical reading anchor");
  await page.setViewportSize({ width: 1440, height: 1000 }); await settle(); await settle();
  const selected = await page.locator("#thread").evaluate(node => {
    const top = node.getBoundingClientRect().top;
    const rows = [...node.querySelectorAll<HTMLElement>("[data-timeline-key]")].filter(row => row.getBoundingClientRect().top >= top).slice(0, 3);
    const startWalker = document.createTreeWalker(rows[0].querySelector(".markdown")!, NodeFilter.SHOW_TEXT);
    const endWalker = document.createTreeWalker(rows.at(-1)!.querySelector(".markdown")!, NodeFilter.SHOW_TEXT);
    const first = startWalker.nextNode() as Text;
    let last = endWalker.nextNode() as Text;
    while (endWalker.nextNode()) last = endWalker.currentNode as Text;
    const range = document.createRange(); range.setStart(first, 0); range.setEnd(last, last.length);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
    return { keys: rows.map(row => row.dataset.timelineKey!), text: getSelection()!.toString() };
  });
  await settle();
  await page.locator("#thread").evaluate(node => { node.scrollTop += node.clientHeight * 4; }); await settle();
  for (const key of selected.keys) assert.equal(await page.locator(`[data-timeline-key="${key}"]`).count(), 1, "all selected rows stay mounted");
  assert.equal(await page.evaluate(() => getSelection()?.toString()), selected.text, "selection text survives window recycling");
  await page.evaluate(() => getSelection()?.removeAllRanges()); await settle();
  assert.equal(await page.locator(".history-range-controls,.history-range-collapse,[data-collapse-segment]").count(), 0, "long-history reading has no collapse controls");
  await bottom(); await page.getByText("当前对话始终可见。", { exact: true }).waitFor();
  assert.equal(await page.locator("button").filter({ hasText: "加载更多" }).count(), 0);
  const catalogueReads = operations.filter(command => command.op === "agent.history.index").length;
  views.messageChanged({ workspaceId: workspace.id, sessionId: long.id }, { id: "live-delta", role: "assistant", text: "流式文本一", streaming: true, status: "running" }); views.flush({ workspaceId: workspace.id, sessionId: long.id });
  await page.getByText("流式文本一", { exact: true }).waitFor();
  views.messageChanged({ workspaceId: workspace.id, sessionId: long.id }, { id: "live-delta", role: "assistant", text: "流式文本二", streaming: true, status: "running" }); views.flush({ workspaceId: workspace.id, sessionId: long.id });
  await page.getByText("流式文本二", { exact: true }).waitFor();
  assert.equal(operations.filter(command => command.op === "agent.history.index").length, catalogueReads, "stream deltas do not reload catalogue");
  const beforeReload = await longChoices();
  await page.reload(); await page.locator("#prompt").waitFor(); await settle(); await settle();
  assert.deepEqual(await longChoices(), beforeReload, "effective reading boundary survives a view reload");
  await page.locator(`[data-session-id="${plain.id}"] button.history-item`).click();
  await page.getByRole("heading", { name: "从一个想法，一行代码开始。", exact: true }).waitFor(); await settle();
  assert.equal(await page.locator(".compaction-card").count(), 0);
  assert.equal(readFileSync(file, "utf8"), before, "reads did not alter the native source");
  assert.deepEqual(errors, []);
  const report = { totalRows: total, maximumMountedRows: Math.max(...maximum), operations: operations.reduce<Record<string, number>>((all, command) => { all[command.op] = (all[command.op] ?? 0) + 1; return all; }, {}), anchorDrift: after!.offset - saved.offset, screenshots: artifacts };
  writeFileSync(join(artifacts, "report.json"), JSON.stringify(report, null, 2));
  console.log("PASS history-segments", JSON.stringify(report));
} finally {
  const diagnostic = browser?.contexts().flatMap(context => context.pages())[0];
  if (diagnostic) {
    await diagnostic.screenshot({ path: join(artifacts, "last-state.png") }).catch(() => {});
    const state = await diagnostic.evaluate(() => ({ body: document.body.innerText, scroll: [...document.querySelectorAll(".thread")].map(node => ({ top: node.scrollTop, height: node.scrollHeight, client: node.clientHeight })), rows: [...document.querySelectorAll<HTMLElement>("[data-timeline-key]")].map(node => ({ key: node.dataset.timelineKey, top: node.getBoundingClientRect().top, height: node.getBoundingClientRect().height })) })).catch(() => null);
    writeFileSync(join(artifacts, "last-state.json"), JSON.stringify(state, null, 2));
  }
  await browser?.close(); await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  if (process.env.AXIOM_HISTORY_KEEP_ROOT !== "1") rmSync(root, { recursive: true, force: true });
}
