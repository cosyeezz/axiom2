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
  await page.goto(app.accessUrl);
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
  await page.locator(".history-item").first().dblclick();
  await page.locator("#rename-title").fill("会话 A");
  await page.getByRole("button", { name: "保存名称" }).click();
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
  assert.equal(await page.locator("#prompt").inputValue(), "项目 A 中文草稿");
  await openWorkspace(other);
  await page.locator("#prompt").fill("项目 B 独立草稿");
  await page.locator("#workspace-picker > summary").click();
  await page.getByRole("button", { name: "项目 A", exact: true }).click();
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
  // Deletion in another viewer clears the stale selection without touching its draft.
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
      (key) => JSON.parse(sessionStorage.getItem(key)!).text,
      `draft:session:${current.workspaceId}:${current.sessionId}`,
    ),
    "项目 A 中文草稿",
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
  await page.goto(app.origin + "/model-config.html");
  await page.locator("#add-supplier").click();
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
  assert.equal(await page.locator("#save-provider").isDisabled(), true);
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
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    await overflow(page, `models ${width}`);
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
    await page
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
  assert.equal(await page.locator("#reset-provider").isDisabled(), true);
  assert.deepEqual(errors, []);
  writeFileSync(
    join(artifacts, "geometry.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    "PASS: 9 viewports × 3 pages, no horizontal overflow; workbench/settings shell geometry vs read-only designs; workspace/session/draft isolation, refresh, IME, independent picker update, memory-only model drafts, multi-select, copy and confirmations. Screenshots: app/test-results/. Full product visual acceptance remains pending.",
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
