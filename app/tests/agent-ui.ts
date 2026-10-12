import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import type { startServer } from "../src/server/index.js";

export async function checkAgentUI(
  page: Page,
  app: Awaited<ReturnType<typeof startServer>>,
  artifacts: string,
) {
  let count = 0,
    response: ServerResponse | undefined,
    release: (() => void) | undefined;
  const fixture = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    JSON.parse(raw);
    count++;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.flushHeaders();
    const chunk = (delta: unknown, finish_reason: string | null = null) =>
      res.write(
        `data: ${JSON.stringify({ id: "ui-fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    if (count === 1) {
      chunk({
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "browser-write",
            type: "function",
            function: {
              name: "write",
              arguments: JSON.stringify({
                path: "browser-verified.txt",
                content: "浏览器真实工具验收\n",
              }),
            },
          },
        ],
      });
      chunk({}, "tool_calls");
      res.end("data: [DONE]\n\n");
    } else {
      response = res;
      chunk({
        role: "assistant",
        content:
          "## 实际输出\n\n**已写入文件**。\n\n```javascript\nconst safe = '<img src=x onerror=alert(1)>';\n```\n\n<script>window.pwned=true</script>\n\n[危险链接](javascript:alert(1))\n\n",
      });
      const timer = setInterval(() => chunk({ content: "流式内容。 " }), 80);
      res.on("close", () => clearInterval(timer));
      release = () => {
        clearInterval(timer);
        chunk({}, "stop");
        res.end("data: [DONE]\n\n");
      };
    }
  });
  await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
  try {
    const dir = join(app.store.root, "pi");
    writeFileSync(
      join(dir, "models.json"),
      JSON.stringify({
        providers: {
          "axiom-browser-fixture": {
            api: "openai-completions",
            baseUrl: `http://127.0.0.1:${(fixture.address() as any).port}/v1`,
            models: [{ id: "fixture", name: "Browser Fixture" }],
          },
        },
      }),
    );
    writeFileSync(
      join(dir, "auth.json"),
      JSON.stringify({
        "axiom-browser-fixture": {
          type: "api_key",
          key: "browser-loopback-only",
        },
      }),
    );
    await app.refreshConfiguration();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(app.origin);
    await page.waitForFunction(() =>
      document.body.innerText.includes("已连接本地服务"),
    );
    await page.locator("#new-chat").click();
    await page.waitForFunction(
      () =>
        !(document.querySelector("#prompt") as HTMLTextAreaElement)?.disabled,
    );
    await page.locator("#model-picker > summary").click();
    await page
      .locator("#model-picker .model-row")
      .filter({ hasText: "Browser Fixture" })
      .hover();
    await page
      .getByRole("button", { name: "收藏模型：Browser Fixture", exact: true })
      .click();
    await page
      .getByRole("button", { name: "取消收藏：Browser Fixture", exact: true })
      .waitFor();
    await page.getByRole("button", { name: /^Browser Fixture/ }).click();
    await page
      .getByRole("button", { name: "确认模型设置", exact: true })
      .click();
    await page.waitForFunction(
      () => !document.querySelector("#model-picker[open]"),
    );
    await page.locator("#prompt").fill("请创建文件并持续输出");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.waitForFunction(() =>
      document.querySelector("#messages")?.textContent?.includes("实际输出"),
    );
    await page.locator(".code-card .tok-keyword").first().waitFor();
    assert.equal(await page.locator(".code-card img").count(), 0);
    await page
      .getByRole("button", { name: "复制代码", exact: true })
      .first()
      .click();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      "const safe = '<img src=x onerror=alert(1)>';",
    );
    const view = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("view")!),
    );
    assert.equal(
      readFileSync(
        join(
          app.store.workspace(view.workspaceId).path,
          "browser-verified.txt",
        ),
        "utf8",
      ),
      "浏览器真实工具验收\n",
    );
    assert.equal(await page.locator("#prompt").inputValue(), "");
    await page.locator("#prompt").fill("流式期间中文草稿");
    await page
      .locator("#prompt")
      .evaluate((n: HTMLTextAreaElement) => n.setSelectionRange(2, 6));
    await page.locator("#prompt").dispatchEvent("keydown", {
      key: "Enter",
      code: "Enter",
      isComposing: true,
    });
    await page.waitForTimeout(250);
    assert.deepEqual(
      await page
        .locator("#prompt")
        .evaluate((n: HTMLTextAreaElement) => [
          document.activeElement === n,
          n.selectionStart,
          n.selectionEnd,
        ]),
      [true, 2, 6],
    );
    assert.equal(
      await page.locator("#prompt").inputValue(),
      "流式期间中文草稿",
    );
    await page.locator("#model-picker > summary").click();
    await page
      .getByRole("searchbox", { name: "搜索模型或供应商" })
      .fill("Browser");
    await page.waitForTimeout(250);
    assert.equal(
      await page
        .getByRole("searchbox", { name: "搜索模型或供应商" })
        .inputValue(),
      "Browser",
    );
    assert.equal(await page.locator("#model-picker").getAttribute("open"), "");
    await page
      .getByRole("searchbox", { name: "搜索模型或供应商" })
      .press("Escape");
    assert.equal(await page.evaluate(() => (window as any).pwned), undefined);
    assert.equal(
      await page.locator('#messages a[href^="javascript:"]').count(),
      0,
    );
    await page
      .locator(".activity > summary")
      .filter({ hasText: "工具调用" })
      .first()
      .click();
    await page.locator(".tool-call > summary").first().click();
    await page.waitForFunction(() =>
      document.querySelector(".tool-call")?.textContent?.includes("已完成"),
    );
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
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth + 1,
        ),
        `stream overflow ${width}`,
      );
      await page.screenshot({
        path: join(artifacts, `agent-running-${width}.png`),
      });
    }
    await page.getByRole("button", { name: "停止执行", exact: true }).click();
    await page.waitForSelector('button:has-text("显式继续")');
    assert.equal(app.agents.info(view).run!.status, "cancelled");
    assert.equal(count, 2);
    await page.reload();
    await page.waitForFunction(() =>
      document.body.innerText.includes("已连接本地服务"),
    );
    await page.waitForFunction(() =>
      document.querySelector("#messages")?.textContent?.includes("实际输出"),
    );
    assert.equal(
      await page.locator("#prompt").inputValue(),
      "流式期间中文草稿",
    );
    assert.equal(count, 2, "reload cannot resend");
    await page.locator("#model-picker > summary").click();
    assert.equal(
      await page
        .getByRole("button", { name: "取消收藏：Browser Fixture", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await page
      .getByRole("searchbox", { name: "搜索模型或供应商" })
      .press("Escape");
    await page.getByRole("button", { name: "显式继续", exact: true }).click();
    await page.waitForFunction(
      () => !!document.querySelector(".send.is-running"),
    );
    for (let i = 0; i < 200 && Number(count) !== 3; i++)
      await page.waitForTimeout(25);
    assert.equal(count, 3);
    release?.();
    await page.waitForFunction(
      () => !document.querySelector(".send.is-running"),
    );
    assert.equal(app.agents.info(view).run!.status, "completed");
    await page.screenshot({ path: join(artifacts, "agent-completed.png") });
  } finally {
    response?.end();
    fixture.closeAllConnections();
    await new Promise<void>((r) => fixture.close(() => r()));
  }
}
