import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import type { startServer } from "../src/server/index.js";
import type { Scope } from "../src/shared/protocol.js";

export async function checkPreviewUI(
  page: Page,
  app: Awaited<ReturnType<typeof startServer>>,
  project: string,
  artifacts: string,
) {
  mkdirSync(join(project, "site"), { recursive: true });
  const original =
    '<h1 id="heading">Original preview</h1><button id="pick" onclick="window.clicked=true">Change me<input type="password" value="DO-NOT-CAPTURE"><span hidden>HIDDEN-TOKEN</span></button>';
  writeFileSync(join(project, "site", "index.html"), original);
  const requests: any[] = [];
  const fixture = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw);
    requests.push(body);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = (delta: unknown, finish_reason: string | null = null) =>
      res.write(
        `data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    if (!JSON.stringify(body.messages).includes('"name":"edit"')) {
      chunk({
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "annotation-edit",
            type: "function",
            function: {
              name: "edit",
              arguments: JSON.stringify({
                path: "site/index.html",
                oldText: "Change me",
                newText: "Changed by annotation",
              }),
            },
          },
        ],
      });
      chunk({}, "tool_calls");
    } else {
      chunk({
        role: "assistant",
        content: "已依据元素评论修改按钮，请刷新预览核实。",
      });
      chunk({}, "stop");
    }
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
  let scope: Scope | undefined;
  try {
    writeFileSync(
      join(app.store.root, "pi", "models.json"),
      JSON.stringify({
        providers: {
          "annotation-fixture": {
            api: "openai-completions",
            baseUrl: `http://127.0.0.1:${(fixture.address() as any).port}/v1`,
            models: [{ id: "fixture", name: "Annotation Fixture" }],
          },
        },
      }),
    );
    writeFileSync(
      join(app.store.root, "pi", "auth.json"),
      JSON.stringify({
        "annotation-fixture": { type: "api_key", key: "fixture" },
      }),
    );
    await app.refreshConfiguration();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(app.origin);
    await page.waitForSelector("#new-chat");
    await page.locator("#new-chat").click();
    await page.locator("#model-picker > summary").click();
    await page.getByRole("button", { name: /^Annotation Fixture/ }).click();
    await page
      .getByRole("button", { name: "确认模型设置", exact: true })
      .click();
    scope = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("view")!),
    );
    await page.getByRole("button", { name: "预览与评论", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "项目预览与元素评论" });
    await dialog.getByLabel("工作空间内的相对目录").fill("site");
    await dialog.getByRole("checkbox").check();
    await dialog
      .getByRole("button", { name: "打开项目预览", exact: true })
      .click();
    const frame = page.frameLocator('iframe[title="隔离项目预览"]');
    await frame.locator("#pick").waitFor();
    await dialog.getByRole("button", { name: "点选元素", exact: true }).click();
    await frame.locator("#pick").click();
    await dialog.locator(".annotation-card").waitFor();
    assert.ok(
      !(await frame
        .locator("body")
        .evaluate(() => Boolean((window as any).clicked))),
      "annotation click must not run page action",
    );
    assert.ok(
      !(await dialog.locator(".annotation-card").textContent())!.includes(
        "HIDDEN-TOKEN",
      ),
    );
    await dialog
      .getByLabel("修改备注")
      .fill("把按钮文字改成 Changed by annotation");
    let release!: () => void;
    const writer = app.agents.models.serial(
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    while (!release) await page.waitForTimeout(5);
    try {
      await dialog
        .getByRole("button", { name: "发送元素评论", exact: true })
        .click();
      await dialog.getByLabel("修改备注").fill("这条新草稿不能被迟到回执清空");
    } finally {
      release();
      await writer;
    }
    await dialog.getByText("评论已发送到绑定会话。", { exact: true }).waitFor();
    assert.equal(
      await dialog.getByLabel("修改备注").inputValue(),
      "这条新草稿不能被迟到回执清空",
    );
    const end = Date.now() + 25000;
    while (
      !readFileSync(join(project, "site", "index.html"), "utf8").includes(
        "Changed by annotation",
      )
    ) {
      if (Date.now() > end) throw Error("annotation edit did not run");
      await page.waitForTimeout(50);
    }
    const messages = JSON.stringify(requests[0].messages);
    assert.match(messages, /页面元素评论/);
    assert.match(messages, /#pick/);
    assert.ok(
      !messages.includes("DO-NOT-CAPTURE") &&
        !messages.includes("HIDDEN-TOKEN"),
    );
    await dialog.getByRole("button", { name: "刷新预览", exact: true }).click();
    await frame
      .getByRole("button", { name: "Changed by annotation" })
      .waitFor();
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
      );
      await page.screenshot({ path: join(artifacts, `preview-${width}.png`) });
    }
    await dialog
      .getByRole("button", { name: "返回工作台", exact: true })
      .click();
    assert.equal(
      app.previews.list(scope!).length,
      1,
      "closing view is not stopping preview",
    );
    await page.getByRole("button", { name: "预览与评论", exact: true }).click();
    await dialog.getByRole("button", { name: "停止预览", exact: true }).click();
    await dialog
      .getByRole("button", { name: "打开项目预览", exact: true })
      .waitFor();
    await dialog
      .getByRole("button", { name: "返回工作台", exact: true })
      .click();
  } finally {
    if (scope)
      for (const preview of app.previews.list(scope))
        await app.previews
          .command({
            requestId: randomUUID(),
            op: "preview.close",
            ...scope,
            params: { previewId: preview.id },
          })
          .catch(() => {});
    fixture.closeAllConnections();
    await new Promise<void>((r) => fixture.close(() => r()));
  }
}
