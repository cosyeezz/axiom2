import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import type { startServer } from "../src/server/index.js";
import { taskActive } from "../src/shared/tasks.js";

export async function checkTasksUI(
  page: Page,
  app: Awaited<ReturnType<typeof startServer>>,
  artifacts: string,
) {
  const checkDelegationOrder = async () => {
    const cards = page.locator("#messages .subagents").first();
    await cards.waitFor();
    assert.ok(await cards.isVisible(), "delegation owns its dedicated card");
    assert.equal(await page.locator('#messages .tool-heading[data-tool="delegate"]').count(), 0, "no duplicate delegation tool row");
    assert.equal(await cards.locator(".delegation-toggle, .task-call-detail").count(), 0);
    assert.ok(!(await cards.locator("header").innerText()).includes("独立 pi 会话"));
  };
  let count = 0;
  const fixture = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    assert.ok(!JSON.stringify(body.messages.at(-1)).includes("工作已停止："), "UI stop must not request a summary");
    count++;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.flushHeaders();
    const main = body.tools?.some((t: any) => t.function.name === "delegate"),
      all = JSON.stringify(body.messages);
    const chunk = (delta: unknown, finish_reason: string | null = null) =>
      res.write(
        `data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    if (main && !all.includes('"name":"delegate"')) {
      chunk({
        role: "assistant",
        content: "已委派独立子任务。",
        tool_calls: [
          {
            index: 0,
            id: "ui-delegation",
            type: "function",
            function: {
              name: "delegate",
              arguments: JSON.stringify({
                context: "只使用此背景",
                tasks: [
                  { task: "检查子任务页面，不修改文件" },
                  { task: "独立检查第二个子任务" },
                ],
              }),
            },
          },
        ],
      });
      chunk({}, "tool_calls");
      res.end("data: [DONE]\n\n");
    } else if (
      main ||
      !body.tools?.length ||
      JSON.stringify(body.messages.at(-1)).includes("工作已停止：")
    ) {
      chunk({
        role: "assistant",
        content: main
          ? "主会话回复已结束，子任务继续运行。"
          : !body.tools?.length &&
              !JSON.stringify(body.messages.at(-1)).includes("工作已停止：")
            ? "子会话独立快照摘要"
            : "工作已停止，没有核实修改，没有回滚。",
      });
      chunk({}, "stop");
      res.end("data: [DONE]\n\n");
    } else {
      chunk({ role: "assistant", content: "## 子会话流式内容\n\n" });
      const timer = setInterval(() => chunk({ content: "独立输出。 " }), 100);
      res.on("close", () => clearInterval(timer));
    }
  });
  await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
  let scope: { workspaceId: string; sessionId: string } | undefined;
  try {
    writeFileSync(
      join(app.store.root, "pi", "models.json"),
      JSON.stringify({
        providers: {
          "sub-ui-fixture": {
            api: "openai-completions",
            baseUrl: `http://127.0.0.1:${(fixture.address() as any).port}/v1`,
            models: [{ id: "fixture", name: "Sub UI Fixture" }],
          },
        },
      }),
    );
    writeFileSync(
      join(app.store.root, "pi", "auth.json"),
      JSON.stringify({ "sub-ui-fixture": { type: "api_key", key: "fixture" } }),
    );
    await app.refreshConfiguration();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(app.origin);
    await page.waitForFunction(() =>
      document.body.innerText.includes("已连接本地服务"),
    );
    await page.locator("#new-chat").click();
    await page.locator("#model-picker > summary").click();
    await page.getByRole("button", { name: /^Sub UI Fixture/ }).click();
    await page
      .getByRole("button", { name: "确认模型设置", exact: true })
      .click();
    await page.locator("#prompt").fill("委派两个独立子任务");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.waitForSelector(".subagent");
    await checkDelegationOrder();
    scope = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("view")!),
    );
    await page.locator("#prompt").fill("父会话保留草稿");
    await page.locator("#prompt").evaluate((n: HTMLTextAreaElement) => {
      n.setSelectionRange(2, 5);
      (window as any).parentInput = n;
    });
    await page.locator(".subagent").first().click();
    const dialog = page.getByRole("dialog", {
      name: "子代理会话",
      exact: true,
    });
    await dialog.waitFor();
    await dialog.getByRole("heading", { name: "子会话流式内容" }).waitFor();
    await dialog.locator("textarea").fill("子窗口独立中文草稿");
    await dialog
      .locator("textarea")
      .evaluate((n: HTMLTextAreaElement) => n.setSelectionRange(3, 7));
    await dialog
      .locator("textarea")
      .dispatchEvent("keydown", { key: "Enter", isComposing: true });
    await page.waitForTimeout(250);
    assert.deepEqual(
      await dialog
        .locator("textarea")
        .evaluate((n: HTMLTextAreaElement) => [
          n === document.activeElement,
          n.selectionStart,
          n.selectionEnd,
        ]),
      [true, 3, 7],
    );
    assert.equal(await page.locator("#prompt").inputValue(), "父会话保留草稿");
    assert.ok(
      await page.evaluate(
        () => document.querySelector("#prompt") === (window as any).parentInput,
      ),
    );
    await dialog.locator(".model-picker > summary").click();
    await dialog.getByRole("searchbox").fill("Sub UI");
    await page.waitForTimeout(250);
    assert.equal(await dialog.getByRole("searchbox").inputValue(), "Sub UI");
    await dialog.getByRole("searchbox").press("Escape");
    assert.ok(await dialog.isVisible());
    for (const [width, height] of [
      [360, 800],
      [390, 844],
      [430, 932],
      [600, 960],
      [820, 1180],
      [1024, 768],
      [1366, 768],
      [1440, 900],
      [1920, 1080],
    ]) {
      await page.setViewportSize({ width, height });
      assert.ok(
        await dialog.evaluate((n) => n.scrollWidth <= n.clientWidth + 1),
        `subdialog overflow ${width}`,
      );
      await page.screenshot({ path: join(artifacts, `subagent-${width}.png`) });
    }
    await dialog
      .getByRole("button", { name: "关闭子代理会话，返回主对话" })
      .click();
    assert.equal(await page.locator("#prompt").inputValue(), "父会话保留草稿");
    assert.ok(
      app.tasks.list(scope!).tasks.some((t) => taskActive(t.status)),
      "closing is not cancellation",
    );
    await page.locator(".subagent").first().click();
    assert.equal(
      await dialog.locator("textarea").inputValue(),
      "子窗口独立中文草稿",
    );
    await dialog.getByRole("button", { name: "停止执行", exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector(".subagent-dialog .send.is-running"),
    );
    await dialog.locator(".task-results summary").click();
    await dialog
      .getByRole("button", { name: "第 1 次 · 已停止", exact: true })
      .click();
    await dialog.getByText(/文件及外部副作用未回滚/).last().waitFor();
    assert.equal(await dialog.getByRole("button", { name: /显式继续|确认清理/ }).count(), 0);
    const stoppedTask = app.tasks.list(scope!).tasks[0];
    const childTrigger = dialog.locator(
      '[data-od-id="background-compression-trigger"]',
    );
    await childTrigger.click();
    await dialog
      .locator(
        '[data-od-id="background-compression-trigger"][data-state="completed"]',
      )
      .waitFor();
    await childTrigger.click();
    const compression = page.getByRole("dialog", {
      name: "后台压缩",
      exact: true,
    });
    await compression.getByText(/子会话独立快照摘要/).waitFor();
    assert.equal(
      app.agents.compressions.info(scope!),
      null,
      "child compression never overwrites parent status",
    );
    assert.equal(
      await compression.evaluate((el) => el.getBoundingClientRect().height),
      page.viewportSize()!.height,
    );
    await compression
      .getByRole("button", { name: "关闭压缩详情，返回会话" })
      .press("Escape");
    await compression.waitFor({ state: "detached" });
    assert.ok(
      await dialog.isVisible(),
      "Escape closes only the top compression sheet",
    );
    assert.ok(
      await childTrigger.evaluate((el) => el === document.activeElement),
    );
    assert.equal(
      await dialog.locator("textarea").inputValue(),
      "子窗口独立中文草稿",
    );
    assert.equal(await page.locator("#prompt").inputValue(), "父会话保留草稿");
    assert.equal(await dialog.getByRole("button", { name: "查看待处理输入（不重发）", exact: true }).count(), 0);
    const previousRun = stoppedTask.runId;
    await dialog.locator("textarea").fill("停止后的普通新追问");
    await dialog.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.waitForFunction(() => !!document.querySelector(".subagent-dialog .send.is-running"));
    assert.notEqual(app.tasks.list(scope!).tasks[0].runId, previousRun);
    assert.equal(await page.locator("#prompt").inputValue(), "父会话保留草稿");
    await dialog
      .getByRole("button", { name: "关闭子代理会话，返回主对话" })
      .click();
    await page.getByRole("button", { name: "停止执行", exact: true }).click();
    await page.waitForFunction(
      () => !document.querySelector(".send.is-running"),
    );
    assert.ok(app.tasks.list(scope!).frozen);
    assert.ok(app.tasks.list(scope!).tasks.every((t) => !taskActive(t.status)));
    const before = count;
    await page.reload();
    await page.waitForSelector(".subagent");
    await page.waitForTimeout(250);
    assert.equal(count, before, "reload must not restart children");
    await checkDelegationOrder();
  } finally {
    if (scope) await app.tasks.stopParent(scope).catch(() => {});
    fixture.closeAllConnections();
    await new Promise<void>((r) => fixture.close(() => r()));
  }
}
