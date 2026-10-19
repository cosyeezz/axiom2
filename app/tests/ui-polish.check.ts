// Layout regressions use actual React pages, isolated data and no model execution.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Locator } from "playwright";
import { startServer } from "../src/server/index.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import { tasksScope } from "../src/shared/tasks.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { Workspace, Session } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-ui-polish-"));
const output = resolve(process.env.AXIOM_LAYOUT_OUTPUT ?? "test-results/ui-polish");
mkdirSync(output, { recursive: true }); mkdirSync(join(root, "pi")); mkdirSync(join(root, "project"));
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
const selection = { provider: "fixture", id: "long-model", thinking: "off" } as const;
const name = "Claude Sonnet 4.5 (Anthropic) - Extended thinking mode";
writeFileSync(join(root, "pi", "models.json"), JSON.stringify({ providers: { fixture: {
  api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [{ id: selection.id, name, input: ["text"], reasoning: true }],
} } }));
writeFileSync(join(root, "pi", "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "fixture" } }));
writeFileSync(join(root, "project", "hello.txt"), "Layout fixture");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
const visibleHit = async (node: Locator) => node.evaluate(el => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
});
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "project"), authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(session.id, JSON.stringify(selection));
  const views = (app.agents as unknown as { views: AgentViews }).views;
  views.messageChanged(scope, { id: "answer", role: "assistant", text: "布局验证：保留聊天内容与草稿。" }); views.flush(scope);
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const context = await browser.newContext({ viewport: { width: 820, height: 700 }, reducedMotion: "reduce" });
  await context.addInitScript(scope => sessionStorage.setItem("view", JSON.stringify(scope)), scope);
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/ws", route => {
    const server = route.connectToServer();
    route.onMessage(raw => {
      const command = JSON.parse(raw.toString());
      if (command.op === "files.complete") route.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: true, data: {
        prefix: "@hel", items: [{ label: "hello.txt", value: "@hello.txt" }],
      } }));
      else server.send(raw);
    });
    server.onMessage(raw => route.send(raw));
  });
  await page.goto(app.origin);
  const input = page.locator("#prompt"); await input.waitFor();
  await page.waitForFunction(() => document.querySelector(".model-picker > summary")?.textContent?.includes("Extended thinking"));
  await input.fill("输入区必须保有实际可用宽度");
  assert.ok((await input.boundingBox())!.width >= 180, "long model name must not squeeze the narrow desktop input");
  await page.screenshot({ path: join(output, "820-long-model.png") });

  // Bind an attachment through the existing picker boundary, then exercise the visual mirror.
  await page.route("**/api/attachments/pick?*", route => route.fulfill({ json: { items: [{ name: "hello.txt", path: join(root, "project", "hello.txt"), kind: "file" }] } }));
  await page.getByRole("button", { name: "添加附件", exact: true }).click();
  await page.locator(".attachment-chip").waitFor();
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await input.fill("[file1] " + "长草稿 mixed text ".repeat(40));
    await input.evaluate(node => { node.scrollLeft = 500; node.scrollTop = node.scrollHeight; node.dispatchEvent(new Event("scroll")); });
    await page.waitForFunction(() => {
      const input = document.querySelector("#prompt")!, mirror = document.querySelector(".attachment-input-overlay")!;
      return Math.abs(input.scrollLeft - mirror.scrollLeft) < 1 && Math.abs(input.scrollTop - mirror.scrollTop) < 1;
    });
    const shape = await input.evaluate(node => {
      const mirror = document.querySelector(".attachment-input-overlay")!;
      return { inputHeight: node.scrollHeight, mirrorHeight: mirror.scrollHeight, inputWidth: node.scrollWidth, mirrorWidth: mirror.scrollWidth, trailingPadding: parseFloat(getComputedStyle(node).paddingRight) };
    });
    // Native textareas omit trailing padding from horizontal scrollWidth in Chromium;
    // a div includes it. Content must still share line layout and exact scroll offsets.
    assert.ok(Math.abs(shape.inputHeight - shape.mirrorHeight) <= 2 && Math.abs(shape.inputWidth - shape.mirrorWidth) <= shape.trailingPadding + 1, JSON.stringify(shape));
  }
  await page.setViewportSize({ width: 390, height: 320 });
  await input.fill("@hel");
  const option = page.getByRole("option", { name: "hello.txt", exact: true }); await option.waitFor();
  assert.ok(await visibleHit(option), "short-screen completion must be visible above the scrolling composer");
  await page.screenshot({ path: join(output, "390-short-completion.png") });
  await option.click(); assert.equal(await input.inputValue(), "@hello.txt ");
  await input.fill("保留草稿");
  await page.locator("#model-picker > summary").click();
  const popup = page.locator("#model-picker .model-popover");
  const box = (await popup.boundingBox())!;
  assert.ok(box.y >= 0 && box.y + box.height <= 320, `short-screen model menu: ${JSON.stringify(box)}`);
  await popup.getByRole("button", { name: "取消模型设置" }).scrollIntoViewIfNeeded();
  assert.ok(await visibleHit(popup.getByRole("button", { name: "取消模型设置" })));
  await popup.getByRole("button", { name: "取消模型设置" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "子代理设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "子代理设置", exact: true });
  await settings.locator(".model-picker > summary").click();
  assert.equal(await settings.locator(".model-popover").evaluate(node => getComputedStyle(node).position), "static", "settings model menu stays inside its scrollable sheet");
  await page.screenshot({ path: join(output, "390-settings-model.png") });
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");

  const description = "检查跨平台布局，保持长任务描述可读和消息区域可用。".repeat(15);
  const records = new TaskRecords(app.store);
  const { taskIds: [taskId] } = records.create(scope, "layout-child", "UI fixture", [{ task: description, role: "" }], { ...selection, thinking: "off" });
  app.store.db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(taskId);
  views.messageChanged(scope, { id: "child-call", role: "assistant", text: "", calls: [{ id: "layout-child", name: "delegate", input: "{}" }] }); views.flush(scope);
  app.agents.publish(tasksScope(scope), app.tasks.list(scope));
  await page.locator(".tool-activity > summary").click();
  await page.getByRole("button", { name: `打开子会话：${description}`, exact: true }).click();
  const child = page.getByRole("dialog", { name: "子代理会话", exact: true });
  await page.setViewportSize({ width: 390, height: 600 });
  assert.ok((await child.locator(".thread").boundingBox())!.height >= 100, "long task title must leave a readable conversation");
  await child.locator(".task-results > details > summary").click();
  assert.equal(await child.locator(".task-description").textContent(), description);
  await child.locator(".task-results > details > summary").click();
  const childInput = child.locator("textarea"); await childInput.fill("@hel"); await option.waitFor();
  assert.ok(await visibleHit(option), "child completion must remain clickable within the modal");
  await childInput.press("Enter"); assert.equal(await childInput.inputValue(), "@hello.txt ");
  await page.screenshot({ path: join(output, "390-child-long-title.png") });
  await child.getByRole("button", { name: "关闭子代理会话，返回主对话" }).click();

  // Coarse pointer landscape uses the same drawer contract as portrait.
  const touch = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true });
  await touch.addInitScript(scope => sessionStorage.setItem("view", JSON.stringify(scope)), scope);
  const landscape = await touch.newPage(); await landscape.goto(app.origin);
  await landscape.getByRole("button", { name: "展开侧栏", exact: true }).click();
  assert.ok(await landscape.locator(".sidebar").isVisible());
  assert.ok(await visibleHit(landscape.getByRole("button", { name: "收起侧栏", exact: true })));
  const history = landscape.locator(`[data-session-id="${session.id}"] .history-item`);
  await history.press("F2");
  const rename = landscape.getByRole("textbox", { name: "会话标题", exact: true });
  assert.equal(await rename.evaluate(node => getComputedStyle(node).fontSize), "16px");
  await rename.fill("候选尚未完成");
  await rename.dispatchEvent("compositionstart");
  await landscape.locator(".sidebar .search input").focus();
  assert.ok(await rename.isVisible(), "blur during composition must preserve the editor");
  await rename.evaluate(node => {
    (node as HTMLInputElement).value = "最终中文标题";
    node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "最终中文标题" }));
  });
  await history.filter({ hasText: "最终中文标题" }).waitFor();
  assert.equal((app.store.db.prepare("SELECT title FROM sessions WHERE id=?").get(session.id) as { title: string }).title, "最终中文标题");
  await landscape.screenshot({ path: join(output, "844-landscape-drawer.png") });
  await touch.close();
  await page.goto(app.origin + "/settings.html");
  for (const width of [320, 390, 640, 820, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator(".module-row").first().waitFor();
    assert.ok(await page.locator(".module-row > div").first().evaluate(node => node.getBoundingClientRect().width > 180), `configuration text column at ${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: join(output, "390-overview.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, browser: browser.version(), output, checks: ["long model input", "attachment mirror and scrolling", "short screen completion and model menu", "inline settings menu", "long child title and modal completion", "landscape drawer", "configuration columns"] }));
} finally {
  await browser?.close(); await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
