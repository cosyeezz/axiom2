import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { startServer } from "../src/server/index.js";
import { checkAgentUI } from "./agent-ui.js";
import { checkTasksUI } from "./tasks-ui.js";
import { checkCompressionUI } from "./compression-ui.js";

const root = mkdtempSync(join(tmpdir(), "axiom-ui-")),
  artifacts = resolve("test-results");
mkdirSync(artifacts, { recursive: true });
const project = join(root, "项目 A");
mkdirSync(project);
const other = join(root, "项目 B");
mkdirSync(other);
const app = await startServer({ root: join(root, "data"), port: 0 });
const reference = createServer((req, res) => {
  const name = new URL(req.url!, "http://127.0.0.1").pathname.slice(1);
  const allow = [
    "coding-agent-v2-before-subagent-modal-v2.html",
    "settings.html",
    "model-config.html",
    "model-config-before-unified-save-v2.html",
  ];
  if (!allow.includes(name)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(readFileSync(resolve("../ui", name)));
});
await new Promise<void>((resolve) => reference.listen(0, "127.0.0.1", resolve));
const refOrigin = `http://127.0.0.1:${(reference.address() as { port: number }).port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.AXIOM_TEST_BROWSER,
});
const errors: string[] = [],
  report: unknown[] = [];
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  permissions: ["clipboard-read", "clipboard-write"],
  reducedMotion: "reduce",
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const design = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  reducedMotion: "reduce",
});
const sizes = [
  [360, 800],
  [390, 844],
  [430, 932],
  [600, 960],
  [820, 1180],
  [1024, 768],
  [1366, 768],
  [1440, 900],
  [1920, 1080],
];
async function ready() {
  await page.waitForFunction(() =>
    document.body.innerText.includes("已连接本地服务"),
  );
}
async function overflow(target: Page, label: string) {
  const dimensions = await target.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  assert.ok(
    dimensions.scroll <= dimensions.client + 1,
    `${label} overflow: ${JSON.stringify(dimensions)}`,
  );
}
async function openWorkspace(path: string) {
  await page.locator("#workspace-picker > summary").click();
  await page.locator("#add-workspace").click();
  await page.locator("#workspace-path").fill(path);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.waitForFunction(
    () => !(document.querySelector("#prompt") as HTMLTextAreaElement)?.disabled,
  );
}
try {
  await page.goto(app.origin + "/connect.html");
  await page
    .locator("#access-link")
    .fill("https://external.example/#access=" + "a".repeat(64));
  await page.getByRole("button", { name: "连接本地服务", exact: true }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "请使用本机服务" })
    .waitFor();
  await page.locator("#access-link").fill(app.accessUrl);
  await page.getByRole("button", { name: "连接本地服务", exact: true }).click();
  await ready();
  assert.equal(new URL(page.url()).hash, "");
  assert.equal(
    await page
      .getByRole("button", { name: "发送消息", exact: true })
      .isDisabled(),
    true,
  );
  await openWorkspace(project);
  await page.locator("#prompt").fill("项目 A 中文草稿");
  await page.waitForTimeout(450);
  assert.equal(await page.locator(".draft-recovery").count(), 0);
  assert.equal(await page.evaluate(() => Object.keys(sessionStorage).some((key) => key.startsWith("draft:"))), false, "unsent text is page-memory only");
  await page.locator(".history-item").first().dblclick();
  await page.getByRole("textbox", { name: "会话标题", exact: true }).fill("会话 A");
  await page.getByRole("textbox", { name: "会话标题", exact: true }).press("Enter");
  await page.waitForFunction(
    () => document.querySelector("#chat-title")?.textContent === "会话 A",
  );
  await page.locator("#new-chat").click();
  await page.waitForFunction(
    () =>
      (document.querySelector("#prompt") as HTMLTextAreaElement)?.value === "",
  );
  await page.locator("#prompt").fill("会话 B 草稿");
  await page.getByRole("button", { name: /^会话 A/, exact: false }).click();
  assert.equal(await page.locator("#prompt").inputValue(), "项目 A 中文草稿");
  await page.locator(".history-row").filter({ has: page.locator("strong", { hasText: /^会话 A$/ }) }).hover();
  await page
    .getByRole("button", { name: "置顶会话：会话 A", exact: true })
    .click();
  await page.locator("#prompt").focus();
  await page.locator("#prompt").evaluate((node) => {
    (node as HTMLTextAreaElement).setSelectionRange(3, 5);
  });
  await page.locator("#prompt").dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
  });
  assert.equal(await page.locator("#prompt").inputValue(), "项目 A 中文草稿");
  await page.locator("#model-picker > summary").click();
  await page
    .getByRole("searchbox", { name: "搜索模型或供应商" })
    .fill("query stays");
  await app.refreshConfiguration();
  assert.equal(
    await page
      .getByRole("searchbox", { name: "搜索模型或供应商" })
      .inputValue(),
    "query stays",
  );
  assert.equal(await page.locator("#model-picker").getAttribute("open"), "");
  await page
    .getByRole("searchbox", { name: "搜索模型或供应商" })
    .press("Escape");
  await page.reload();
  await ready();
  assert.equal(await page.locator("#prompt").inputValue(), "", "refresh does not restore unsent text");
  await page.locator("#prompt").fill("项目 A 中文草稿");
  await openWorkspace(other);
  await page.locator("#prompt").fill("项目 B 独立草稿");
  const pins = page.getByRole("region", { name: "置顶会话", exact: true });
  await pins.getByRole("button", { name: /^会话 A/ }).waitFor();
  assert.equal(await page.locator('.history-item').count(), 2);
  await page.getByRole("searchbox", { name: "搜索置顶和当前空间的会话" }).fill("会话 A");
  assert.equal(await page.locator('.history-item').count(), 1);
  await pins.getByRole("button", { name: /^会话 A/ }).click();
  await page.waitForFunction(() =>
    document.querySelector("#workspace-picker summary strong")?.textContent === "项目 A" &&
    (document.querySelector("#prompt") as HTMLTextAreaElement)?.value === "项目 A 中文草稿",
  );
  await page.locator("#workspace-picker > summary").click();
  await page.getByRole("button", { name: "项目 B", exact: true }).click();
  await page.waitForFunction(() =>
    (document.querySelector("#prompt") as HTMLTextAreaElement)?.value === "项目 B 独立草稿",
  );
  // Pin actions must use the foreign session's owner, not the viewed workspace.
  await pins.locator(".history-row").hover();
  await pins.getByRole("button", { name: "取消置顶：会话 A", exact: true }).click();
  await pins.waitFor({ state: "hidden" });
  assert.equal(await page.locator('.history-item').count(), 1);
  await page.locator("#workspace-picker > summary").click();
  await page.getByRole("button", { name: "项目 A", exact: true }).click();
  await page.getByRole("button", { name: /^会话 A/ }).click();
  await page.locator(".history-row").filter({ has: page.locator("strong", { hasText: /^会话 A$/ }) }).hover();
  await page.getByRole("button", { name: "置顶会话：会话 A", exact: true }).click();
  await page.waitForFunction(
    () =>
      (document.querySelector("#prompt") as HTMLTextAreaElement)?.value ===
      "项目 A 中文草稿",
  );
  assert.equal(await page.locator("#thread").count(), 1);
  const second = await context.newPage();
  await second.goto(app.origin);
  await second.waitForSelector("#new-chat");
  assert.equal(
    await second.locator("#prompt").isDisabled(),
    true,
    "second tab must not navigate to first tab selection",
  );
  await second.close();
  // A slow receipt must not navigate away from a selection made after the request.
  const delayed = await context.newPage();
  let releaseCreation: (() => void) | undefined;
  await delayed.routeWebSocket("**/ws", (route) => {
    const server = route.connectToServer();
    let creating: string | undefined;
    route.onMessage((message) => {
      const value = JSON.parse(message.toString());
      if (value.op === "session.create") creating = value.requestId;
      server.send(message);
    });
    server.onMessage((message) => {
      const value = JSON.parse(message.toString());
      if (creating && value.type === "receipt" && value.requestId === creating)
        releaseCreation = () => route.send(message);
      else route.send(message);
    });
  });
  await delayed.goto(app.origin);
  await delayed.locator("#workspace-picker > summary").click();
  await delayed.getByRole("button", { name: "项目 A", exact: true }).click();
  await delayed.waitForFunction(
    () => document.querySelector("#chat-title")?.textContent === "会话 A",
  );
  await delayed.locator("#new-chat").click();
  for (let i = 0; i < 100 && !releaseCreation; i++)
    await delayed.waitForTimeout(20);
  assert.ok(releaseCreation, "creation receipt must be held");
  await delayed.locator("#workspace-picker > summary").click();
  await delayed.getByRole("button", { name: "项目 B", exact: true }).click();
  releaseCreation();
  await delayed.waitForTimeout(100);
  assert.equal(
    await delayed.locator("#workspace-picker summary strong").textContent(),
    "项目 B",
  );
  await delayed.close();
  // Deletion in another viewer clears the stale selection; reload has no persisted draft.
  const current = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("view")!),
  );
  app.store.execute({
    requestId: crypto.randomUUID(),
    op: "session.delete",
    ...current,
    params: { confirmed: true },
  });
  await page.reload();
  await ready();
  await page.waitForFunction(
    (id) => JSON.parse(sessionStorage.getItem("view")!).sessionId !== id,
    current.sessionId,
  );
  assert.equal(
    await page.evaluate(
      (key) => sessionStorage.getItem(key),
      `draft:session:${current.workspaceId}:${current.sessionId}`,
    ),
    null,
  );
  await design.goto(
    refOrigin + "/coding-agent-v2-before-subagent-modal-v2.html",
  );
  await design.locator("#new-chat").click();
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await design.setViewportSize({ width, height });
    await overflow(page, `workbench ${width}`);
    const compare = [];
    for (const selector of [
      ".sidebar",
      ".topnav",
      ".thread",
      ".composer",
      ".send",
      ".usage",
    ]) {
      const actual = await page.locator(selector).first().boundingBox(),
        expected = await design.locator(selector).first().boundingBox();
      if (actual && expected) {
        assert.ok(
          Math.abs(actual.width - expected.width) <= 1,
          `width differs ${width} ${selector}: ${actual.width}/${expected.width}`,
        );
        compare.push({ selector, actual, expected });
      }
    }
    report.push({ page: "workbench", width, compare });
    await page.screenshot({
      path: join(artifacts, `workbench-${width}.png`),
      fullPage: true,
    });
    await design.screenshot({
      path: join(artifacts, `design-workbench-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
  assert.equal(await page.locator("#history-sidebar").isVisible(), true);
  await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
  assert.equal(await page.locator("#history-sidebar").isVisible(), false);
  await page.goto(app.origin + "/settings.html");
  await ready();
  await design.goto(refOrigin + "/settings.html");
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await design.setViewportSize({ width, height });
    await overflow(page, `settings ${width}`);
    for (const selector of [
      ".settings-main",
      ".topnav",
      ".overview-intro",
      ".module-row",
    ]) {
      const actual = await page.locator(selector).boundingBox(),
        expected = await design.locator(selector).boundingBox();
      assert.ok(
        actual && expected && Math.abs(actual.width - expected.width) <= 1,
        `settings width ${width} ${selector}`,
      );
    }
    await page.screenshot({
      path: join(artifacts, `settings-${width}.png`),
      fullPage: true,
    });
    await design.screenshot({
      path: join(artifacts, `design-settings-${width}.png`),
      fullPage: true,
    });
  }
  assert.equal(await page.getByText("子任务并发与预算", { exact: true }).count(), 0);
  await page.goto(app.origin);
  await page.getByRole("button", { name: "子代理设置", exact: true }).click();
  const taskSettings = page.getByRole("dialog", { name: "子代理设置", exact: true });
  const concurrencyInput = taskSettings.getByRole("spinbutton", { name: "同时运行的子任务", exact: true });
  await concurrencyInput.fill("3");
  await concurrencyInput.press("Enter");
  await taskSettings.getByRole("status").filter({ hasText: "已全局保存并生效" }).waitFor();
  assert.equal(app.tasks.preferences().concurrency, 3);
  await taskSettings.getByRole("button", { name: "关闭子代理设置" }).click();
  await page.getByRole("button", { name: "子代理设置", exact: true }).click();
  await page.waitForFunction(() => document.querySelector<HTMLInputElement>(".subagent-budget-field input")?.value === "3");
  assert.equal(await concurrencyInput.inputValue(), "3");
  await page.goto(app.origin + "/model-config.html");
  await page.locator("#add-supplier").click();
  await page.getByRole("menuitem", { name: "自定义接口", exact: true }).click();
  await page.locator("#provider-name").fill("界面验收供应商");
  await page.locator("#provider-url").fill("http://127.0.0.1:1/v1");
  await page.locator("#provider-key").fill("UI-TEST-ONLY-SECRET");
  await page.getByRole("tab", { name: /模型配置/ }).click();
  await page.locator("#add-model").click();
  await page
    .locator("#new-model-id")
    .fill("long-model-id-" + "complete-value-".repeat(9));
  await page.locator("#new-model-name").fill("验收模型名称");
  await page.getByRole("checkbox", { name: "high", exact: true }).check();
  await page.getByRole("checkbox", { name: "max", exact: true }).check();
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  assert.equal(await page.locator("#save-provider").isDisabled(), false);
  await page.locator("#configured-model-table tbody tr").first().hover();
  await page
    .getByRole("button", { name: "复制模型名称：验收模型名称", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("#model-copy-feedback")
      ?.textContent?.startsWith("已复制模型名称"),
  );
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "验收模型名称",
  );
  await page
    .getByRole("button", { name: "编辑模型：验收模型名称", exact: true })
    .click();
  await design.goto(refOrigin + "/model-config.html");
  await design.locator("#models-tab").click();
  await design.locator("#add-model").click();
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await design.setViewportSize({ width, height });
    await overflow(page, `models ${width}`);
    const columns = (el: Element) =>
      getComputedStyle(el).gridTemplateColumns.split(" ").length;
    assert.equal(
      await page.locator(".inline-model-fields").evaluate(columns),
      await design.locator(".inline-model-fields").evaluate(columns),
    );
    const style = (el: Element) => {
      const s = getComputedStyle(el);
      return [
        s.borderRadius,
        s.backgroundColor,
        s.boxShadow,
        s.fontFamily,
        s.minHeight,
      ];
    };
    assert.deepEqual(
      await page
        .locator("#reasoning-level-options label span")
        .first()
        .evaluate(style),
      await design
        .locator("#reasoning-level-options label span")
        .first()
        .evaluate(style),
    );
    assert.equal(
      await page
        .getByRole("checkbox", { name: "high", exact: true })
        .isChecked(),
      true,
    );
    await page.screenshot({
      path: join(artifacts, `models-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#new-model-name").fill("尚未完成的编辑");
  for (const trigger of ["#add-model", "#add-supplier"]) {
    await page.locator(trigger).click();
    if (trigger === "#add-supplier") await page.keyboard.press("Escape");
    else await page
      .getByRole("dialog")
      .getByRole("button", { name: "取消", exact: true })
      .click();
    assert.equal(
      await page.locator("#new-model-name").inputValue(),
      "尚未完成的编辑",
    );
  }
  await page
    .getByRole("button", { name: "删除模型：验收模型名称", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  await page
    .getByRole("button", { name: /^复制模型 ID：/ })
    .filter({ visible: true })
    .click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "long-model-id-" + "complete-value-".repeat(9),
  );
  const browserState = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  assert.ok(!browserState.includes("UI-TEST-ONLY-SECRET"));
  assert.ok(
    !browserState.includes("界面验收供应商"),
    "configuration drafts never persist in browser storage",
  );
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  await page.locator("#add-supplier").click();
  await page.getByRole("menuitem", { name: "自定义接口", exact: true }).click();
  await page.locator("#provider-name").fill("切换验证供应商");
  await page
    .locator(".supplier-option")
    .filter({ hasText: "界面验收供应商" })
    .click();
  await page.getByRole("tab", { name: /模型配置/ }).click();
  await page.locator("#configured-model-table tbody tr").first().hover();
  await page
    .getByRole("button", { name: "编辑模型：尚未完成的编辑", exact: true })
    .click();
  await page.locator("#new-model-name").fill("验收模型名称");
  await page.getByRole("checkbox", { name: "max", exact: true }).uncheck();
  await page
    .locator(".supplier-option")
    .filter({ hasText: "切换验证供应商" })
    .click();
  await page
    .locator(".supplier-option")
    .filter({ hasText: "界面验收供应商" })
    .click();
  await page.locator("#configured-model-table tbody tr").first().hover();
  await page
    .getByRole("button", { name: "编辑模型：验收模型名称", exact: true })
    .click();
  assert.equal(
    await page.getByRole("checkbox", { name: "max", exact: true }).isChecked(),
    false,
  );
  assert.equal(
    await page.getByRole("checkbox", { name: "high", exact: true }).isChecked(),
    true,
  );
  await page.locator("#new-model-id").fill("");
  await page.getByRole("tab", { name: /连接配置/ }).click();
  await page.locator("#save-provider").click();
  await page.locator("#new-model-id").waitFor({ state: "visible" });
  assert.equal(
    await page.locator("#new-model-id").inputValue(),
    "",
    "invalid hidden editor is preserved for correction",
  );
  await page.locator("#reset-provider").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "编辑模型：验收模型名称", exact: true })
      .count(),
    1,
  );
  await page.locator("#reset-provider").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await page.waitForFunction(() => !document.querySelector(".supplier-option"));
  assert.equal(await page.locator("#reset-provider").isDisabled(), true);
  // Publish through the real service; a test key checks local persistence, not remote authentication.
  await page.locator("#add-supplier").click();
  await page.getByRole("menuitem", { name: "自定义接口", exact: true }).click();
  await page.locator("#provider-id").fill("axiom-ui-check");
  await page.locator("#provider-name").fill("可发布供应商");
  await page.locator("#provider-url").fill("http://127.0.0.1:1/v1");
  await page.locator("#provider-key").fill("UI-PUBLISH-TEST-KEY");
  const headers = page.getByRole("region", { name: "供应商请求头覆盖" });
  await headers.getByRole("button", { name: /添加一项/ }).click();
  await headers.getByLabel("第 1 项 key", { exact: true }).fill("X-UI-Test");
  await headers
    .getByLabel("第 1 项 value", { exact: true })
    .fill("UI-HEADER-SECRET");
  const body = page
    .getByRole("region", { name: "请求体覆盖", exact: true })
    .filter({ visible: true });
  await body.getByRole("button", { name: /添加一项/ }).click();
  await body.getByLabel("第 1 项请求体值", { exact: true }).fill("0.3");
  await page.getByRole("tab", { name: /模型配置/ }).click();
  await page.locator("#add-model").click();
  await page.locator("#new-model-id").fill("ui-model");
  await page.getByRole("checkbox", { name: "high", exact: true }).check();
  // Unified Save also includes the unfinished model form hidden behind the connection tab.
  await page.getByRole("tab", { name: /连接配置/ }).click();
  assert.equal(await page.locator("#save-provider").isDisabled(), false);
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  await page.getByRole("tab", { name: /连接配置/ }).click();
  assert.equal(await page.locator("#provider-key").inputValue(), "");
  assert.equal(
    await headers.getByLabel("第 1 项 value", { exact: true }).inputValue(),
    "",
  );
  assert.equal(
    JSON.parse(readFileSync(join(root, "data/pi/models.json"), "utf8"))
      .providers["axiom-ui-check"].models[0].samplingParams.temperature,
    0.3,
  );
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await overflow(page, `models connection ${width}`);
    await page.screenshot({
      path: join(artifacts, `models-connection-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    !(await page
      .locator("body")
      .innerText()
      .then((t) => t.includes("UI-PUBLISH-TEST-KEY"))),
  );
  assert.equal(await page.getByRole("button", { name: "API Key 登录", exact: true }).count(), 0);
  await page.locator("#provider-key").fill("UI-LOGIN-TEST-KEY");
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await overflow(page, `model key ${width}`);
    await page.screenshot({
      path: join(artifacts, `models-key-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  assert.equal(JSON.parse(readFileSync(join(root, "data/pi/auth.json"), "utf8"))["axiom-ui-check"].key, "UI-LOGIN-TEST-KEY");
  await page.reload();
  await page.waitForFunction(
    () =>
      (document.querySelector("#provider-name") as HTMLInputElement)?.value ===
      "可发布供应商",
  );
  await page.locator("#provider-key").fill("UI-CANCELLED-KEY");
  await page.locator("#reset-provider").click();
  await page.getByRole("dialog", { name: "放弃修改？" }).getByRole("button", { name: "确认", exact: true }).click();
  await page.waitForFunction(() => (document.querySelector("#provider-key") as HTMLInputElement)?.value === "");
  assert.equal(JSON.parse(readFileSync(join(root, "data/pi/auth.json"), "utf8"))["axiom-ui-check"].key, "UI-LOGIN-TEST-KEY");
  // External updates leave the local draft/focus intact; stale publication cannot overwrite them.
  await page.locator("#provider-name").fill("保留本页草稿");
  const configPath = join(root, "data/pi/models.json"),
    external = JSON.parse(readFileSync(configPath, "utf8"));
  external.providers["axiom-ui-check"].name = "其他页面修改";
  writeFileSync(configPath, JSON.stringify(external));
  await app.refreshConfiguration();
  assert.equal(
    await page.locator("#provider-name").inputValue(),
    "保留本页草稿",
  );
  assert.equal(
    await page
      .locator("#provider-name")
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.locator("#save-provider").click();
  await page.waitForFunction(() =>
    document.body.innerText.includes("配置已被修改"),
  );
  assert.equal(
    JSON.parse(readFileSync(configPath, "utf8")).providers["axiom-ui-check"]
      .name,
    "其他页面修改",
  );
  await page.getByRole("button", { name: "重新读取配置", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  assert.equal(
    await page.locator("#provider-name").inputValue(),
    "保留本页草稿",
  );
  await page.getByRole("button", { name: "重新读取配置", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      (document.querySelector("#provider-name") as HTMLInputElement)?.value ===
      "其他页面修改",
  );
  await page.getByRole("tab", { name: /模型配置/ }).click();
  await page.getByRole("button", { name: "删除模型：ui-model", exact: true }).locator("xpath=ancestor::tr").hover();
  await page
    .getByRole("button", { name: "删除模型：ui-model", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await page.locator("#save-provider").click();
  await page
    .getByRole("dialog", { name: "确认供应商级退出登录？" })
    .getByRole("button", { name: "取消", exact: true })
    .click();
  assert.ok(
    JSON.parse(readFileSync(join(root, "data/pi/auth.json"), "utf8"))[
      "axiom-ui-check"
    ],
  );
  await page.locator("#save-provider").click();
  await page
    .getByRole("dialog", { name: "确认供应商级退出登录？" })
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await page.waitForFunction(() =>
    document.body.innerText.includes("配置已发布并刷新目录"),
  );
  assert.equal(
    JSON.parse(readFileSync(join(root, "data/pi/auth.json"), "utf8"))[
      "axiom-ui-check"
    ],
    undefined,
  );
  await page.getByRole("tab", { name: /连接配置/ }).click();
  await page.getByRole("button", { name: "删除供应商", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "取消", exact: true })
    .click();
  assert.ok(
    JSON.parse(readFileSync(configPath, "utf8")).providers["axiom-ui-check"],
  );
  await page.getByRole("button", { name: "删除供应商", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await page.waitForFunction(() => !document.querySelector(".supplier-option"));
  assert.equal(
    JSON.parse(readFileSync(configPath, "utf8")).providers["axiom-ui-check"],
    undefined,
  );
  await checkAgentUI(page, app, artifacts);
  await checkCompressionUI(page, design, app, artifacts, sizes);
  await checkTasksUI(page, app, artifacts);
  assert.deepEqual(errors, []);
  writeFileSync(
    join(artifacts, "geometry.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    "PASS: 9 viewports × 3 pages, no horizontal overflow; workbench/settings shell geometry vs read-only designs; workspace/session/draft isolation, refresh, IME, independent picker update, model publication, redaction, revision conflict with preserved draft/focus, API-key save/cancel, model/provider deletion, multi-select and copy, hidden inline-editor unified Save, two-column reasoning styles; context ring boundaries/unknown ARIA, real background snapshot compression, cancel/retry/no-replay/focus, nine-viewport compression sheet vs design and reduced motion; product Agent worker/tool streaming, safe Markdown/code highlighting/copy, favorites, memory-only drafts, session management, task settings and Connect validation; independent child dialogs/stop/results/freeze; IME/focus/menu preservation, stop/fresh prompt and reload without replay (loopback). Screenshots: app/test-results/. Full product visual acceptance remains pending.",
  );
} catch (error) {
  await page.screenshot({
    path: join(artifacts, "failure.png"),
    fullPage: true,
  });
  console.error(
    "Browser errors:",
    errors,
    "\nPage:",
    await page.locator("body").innerText(),
  );
  throw error;
} finally {
  await browser.close();
  await app.close();
  await new Promise<void>((resolve) => reference.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
}
