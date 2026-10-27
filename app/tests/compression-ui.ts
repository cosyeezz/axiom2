import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { randomUUID } from "node:crypto";
import { isCompressionRequest } from "./compression-memory-fixture.js";
import type { startServer } from "../src/server/index.js";

export async function checkCompressionUI(
  page: Page,
  design: Page,
  app: Awaited<ReturnType<typeof startServer>>,
  artifacts: string,
  sizes: number[][],
) {
  const requests: any[] = [],
    responses: ServerResponse[] = [];
  let complete = false;
  const reply = (res: ServerResponse, content = "## Goal\n真实压缩摘要 <script>window.pwned=true</script>") => {
    for (const [delta, finish_reason] of [
      [
        {
          role: "assistant",
          content,
        },
        null,
      ],
      [{}, "stop"],
    ])
      res.write(
        `data: ${JSON.stringify({ id: "summary", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    res.end("data: [DONE]\n\n");
  };
  const fixture = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (!isCompressionRequest(body)) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      reply(res, "真实会话回复");
      return;
    }
    requests.push(body);
    responses.push(res);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.flushHeaders();
    if (complete) reply(res);
  });
  await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
  const scope = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("view")!),
  );
  const trigger = page.locator('[data-od-id="background-compression-trigger"]');
  const dialog = page.getByRole("dialog", { name: "后台压缩", exact: true });
  const close = () =>
    dialog.getByRole("button", { name: "关闭压缩详情，返回会话" }).click();
  try {
    const path = join(app.store.root, "pi/models.json"),
      config = JSON.parse(readFileSync(path, "utf8"));
    config.providers["axiom-browser-fixture"].baseUrl =
      `http://127.0.0.1:${(fixture.address() as any).port}/v1`;
    writeFileSync(path, JSON.stringify(config));
    await app.refreshConfiguration();
    const chat = async (text: string) => {
      await app.agents.command({ ...scope, requestId: randomUUID(), op: "prompt", params: { text } });
      const end = Date.now() + 20000;
      while (app.agents.active(scope)) {
        assert.ok(Date.now() < end, "chat prefix fixture did not settle");
        await page.waitForTimeout(25);
      }
      await app.agents.releaseIdle(scope);
    };
    // The changed endpoint needs a fresh real request, not an old cached identity.
    await chat("压缩前刷新当前会话请求前缀");
    // Seed measured boundary values only in the test, then restore actual worker statistics.
    const usage = app.agents.info(scope).usage!;
    const ring = page.locator(
      '[data-od-id="context-capacity"] svg.data-icon',
    );
    for (const [tokens, window, expected] of [
      [0, 100, 0],
      [25, 100, 25],
      [50, 100, 50],
      [100, 100, 100],
      [150, 100, 150],
      [20, 0, null],
      [20, -1, null],
      [null, 0, null], // A known capacity now allows a read-only pi history estimate.
    ]) {
      app.store.db
        .prepare("UPDATE agent_sessions SET usage=? WHERE sessionId=?")
        .run(
          JSON.stringify({
            ...usage,
            context: { tokens, window, percent: null },
          }),
          scope.sessionId,
        );
      app.agents.refresh(scope);
      await page.waitForFunction(
        (value) =>
          document
            .querySelector('[data-od-id="context-capacity"] svg.data-icon')
            ?.getAttribute("data-value") === value,
        expected == null ? "unknown" : String(expected),
      );
      // The combined context/memory icon now draws a measured arc and three
      // progress rows, rather than ten dashed sectors plus a <use> glyph.
      const filled = await ring.evaluate(svg => {
        const track = svg.querySelector<SVGPathElement>('path.data-track')!;
        const fill = svg.querySelector<SVGPathElement>('path.data-filled');
        return fill ? fill.getTotalLength() / track.getTotalLength() * 100 : 0;
      });
      assert.ok(Math.abs(filled - Math.min(100, expected ?? 0)) < 0.5);
      assert.equal(await ring.locator('.memory-progress-bars > path').count(), 3);
    }
    app.store.db
      .prepare("UPDATE agent_sessions SET usage=? WHERE sessionId=?")
      .run(JSON.stringify(usage), scope.sessionId);
    app.agents.refresh(scope);
    assert.equal(await page.locator(".gauge-needle").count(), 0);
    assert.equal(
      await page.locator("#prompt").getAttribute("placeholder"),
      "Ask axiom…",
    );
    await page.locator("#prompt").fill("压缩期间继续编辑的中文草稿");
    await trigger.click();
    await dialog.waitFor();
    assert.equal(requests.length, 0, "opening the compression page does not start a model request");
    assert.equal(app.agents.compressions.info(scope), null);
    await dialog.getByRole("button", { name: "开始压缩", exact: true }).click();
    await page.waitForSelector(
      '[data-od-id="background-compression-trigger"][data-state="running"]',
    );
    await close();
    await page.locator("#prompt").focus();
    await page
      .locator("#prompt")
      .evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(2, 7));
    for (let i = 0; i < 300 && !responses.length; i++)
      await page.waitForTimeout(25);
    assert.equal(responses.length, 1);
    assert.ok(
      requests[0].tools?.length,
      "native summary keeps tool schemas for cache parity, without an executor",
    );
    assert.deepEqual(
      await page
        .locator("#prompt")
        .evaluate((el: HTMLTextAreaElement) => [
          el === document.activeElement,
          el.selectionStart,
          el.selectionEnd,
        ]),
      [true, 2, 7],
    );
    await trigger.click();
    await dialog.waitFor();
    await dialog
      .getByRole("button", { name: "关闭压缩详情，返回会话" })
      .press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.ok(await trigger.evaluate((el) => el === document.activeElement));
    assert.equal(app.agents.compressions.info(scope)!.state, "running");
    await trigger.click();
    // Run only the prototype's native demonstration to compare the designed sheet; product remains real pi.
    await design.goto(
      new URL("coding-agent-v2-before-subagent-modal-v2.html", design.url())
        .href,
    );
    await design.evaluate(() => localStorage.clear());
    await design.reload();
    await design.locator("#compression-trigger").click();
    await design.locator("#compression-trigger").click();
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await design.setViewportSize({ width, height });
      const actual = await dialog.boundingBox(),
        expected = await design.locator(".compression-page").boundingBox();
      assert.ok(actual && expected);
      // Width/alignment follow the prototype; typography uses the newer shared
      // toolbar drawer, and the session launcher must remain exposed.
      for (const key of ["x", "y", "width"] as const)
        assert.ok(
          Math.abs(actual[key] - expected[key]) <= 1,
          `compression sheet geometry ${width} ${key}`,
        );
      const launcher = (await trigger.boundingBox())!;
      assert.ok(Math.abs(actual.y + actual.height + 8 - launcher.y) <= 1, `compression sheet clears its launcher at ${width}`);
      const panelStyle = await dialog.evaluate(el => {
        const sections = [];
        for (const selector of [':scope > header', ':scope > footer', '.compression-body']) {
          const css = getComputedStyle(el.querySelector(selector)!);
          sections.push({ left: css.paddingLeft, right: css.paddingRight, font: css.fontFamily, background: css.backgroundColor });
        }
        return { shared: el.classList.contains('toolbar-detail-panel'), bodyFont: getComputedStyle(document.body).fontFamily,
          header: sections[0], footer: sections[1], body: sections[2] };
      });
      assert.equal(panelStyle.shared, true);
      assert.deepEqual([panelStyle.header.left, panelStyle.header.right], ['20px', '12px']);
      for (const section of [panelStyle.footer, panelStyle.body]) assert.deepEqual([section.left, section.right], ['20px', '20px']);
      for (const section of [panelStyle.header, panelStyle.footer, panelStyle.body]) assert.equal(section.font, panelStyle.bodyFont);
      assert.equal(panelStyle.header.background, panelStyle.footer.background);
      assert.notEqual(panelStyle.header.background, 'rgba(0, 0, 0, 0)', 'shared drawer chrome uses the surface color');
      assert.ok(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      );
      await page.screenshot({
        path: join(artifacts, `compression-${width}.png`),
      });
      await design.screenshot({
        path: join(artifacts, `design-compression-${width}.png`),
      });
    }
    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      await page.emulateMedia({ reducedMotion });
      const frames = await dialog.locator(".compression-status .data-icon").evaluate(node => {
        const svg = node as SVGSVGElement;
        svg.pauseAnimations();
        svg.setCurrentTime(0.2);
        const first = [...svg.querySelectorAll("circle")].map(circle => [circle.r.animVal.value, getComputedStyle(circle).opacity]);
        svg.setCurrentTime(0.7);
        const second = [...svg.querySelectorAll("circle")].map(circle => [circle.r.animVal.value, getComputedStyle(circle).opacity]);
        svg.unpauseAnimations();
        return { first, second };
      });
      assert.ok([3, 8].includes(frames.first.length));
      assert.notDeepEqual(frames.first, frames.second, `compression bubbles animate in ${reducedMotion}`);
    }
    await close();
    // Completing a model call must not disturb a selected draft or mount the detail sheet.
    await page.locator("#prompt").focus();
    await page
      .locator("#prompt")
      .evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(2, 7));
    complete = true;
    for (const res of responses) if (!res.writableEnded) reply(res);
    await page.waitForSelector(
      '[data-od-id="background-compression-trigger"][data-state="completed"]',
    );
    assert.equal(await trigger.locator('use[href="#i-fold"]').count(), 1);
    assert.equal(await trigger.locator("animate,animateTransform").count(), 0);
    assert.equal(
      await page.locator("#prompt").inputValue(),
      "压缩期间继续编辑的中文草稿",
    );
    assert.deepEqual(
      await page
        .locator("#prompt")
        .evaluate((el: HTMLTextAreaElement) => [
          el === document.activeElement,
          el.selectionStart,
          el.selectionEnd,
        ]),
      [true, 2, 7],
    );
    await trigger.click();
    await dialog.getByText(/真实压缩摘要/).first().waitFor();
    assert.equal(await dialog.locator("script").count(), 0);
    assert.equal(await page.evaluate(() => (window as any).pwned), undefined);
    complete = false;
    await chat("压缩后的新增上下文，用于再次压缩取消测试");
    app.agents.refresh(scope);
    await dialog.getByRole("button", { name: "再次压缩", exact: true }).click();
    await dialog.locator('.compression-status[data-state="running"]').waitFor();
    await dialog.getByRole("button", { name: "取消压缩", exact: true }).click();
    await dialog
      .locator('.compression-status[data-state="cancelled"]')
      .waitFor();
    await close();
    const id = app.agents.compressions.info(scope)!.id,
      before = requests.length;
    await page.reload();
    await page.waitForSelector(
      '[data-od-id="background-compression-trigger"][data-state="cancelled"]',
    );
    assert.equal(app.agents.compressions.info(scope)!.id, id);
    assert.equal(requests.length, before, "reload cannot resubmit compression");
    await page.locator("#new-chat").click();
    await page.waitForSelector(
      '[data-od-id="background-compression-trigger"][data-state="idle"]:enabled',
    );
    await trigger.click();
    await dialog.waitFor();
    assert.equal(await dialog.getByRole("button", { name: "开始压缩", exact: true }).isDisabled(), true);
    await dialog.getByText("此会话尚无消息可压缩。", { exact: true }).waitFor();
    assert.equal(requests.length, before, "opening an empty session cannot submit compression");
    await close();
  } finally {
    await app.agents.compressions.stop(scope);
    fixture.closeAllConnections();
    await new Promise<void>((r) => fixture.close(() => r()));
  }
}
