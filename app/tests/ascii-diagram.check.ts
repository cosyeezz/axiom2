// Run: AXIOM_TEST_BROWSER=/path/to/chrome npx tsx tests/ascii-diagram.check.ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = await mkdtemp(join(tmpdir(), "axiom-ascii-diagram-"));
const appRoot = resolve("."), artifacts = resolve("test-results/ascii-diagram");
await mkdir(artifacts, { recursive: true });
await writeFile(join(root, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs/${appRoot}/tests/fixtures/ascii-diagram.tsx"></script></body></html>`);
const server = await createServer({ configFile: false, root, cacheDir: join(root, "cache"), resolve: { alias: { react: join(appRoot, "node_modules/react"), "react-dom": join(appRoot, "node_modules/react-dom") } }, esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0, fs: { allow: [root, appRoot] } } });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ permissions: ["clipboard-read", "clipboard-write"] });
  const errors: string[] = [], external: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (!request.url().startsWith(server.resolvedUrls!.local[0])) external.push(request.url()); });
  await page.goto(server.resolvedUrls!.local[0]);
  const plain = page.locator("#plain"), fenced = page.locator("#fenced");
  await fenced.getByRole("img", { name: "字符图美化视图" }).waitFor();
  assert.equal(await plain.locator("svg.ascii-diagram-svg").count(), 1);
  assert.equal(await page.locator("#ascii svg.ascii-diagram-svg").count(), 1);
  assert.equal(await page.locator("#vertical svg.ascii-diagram-svg").count(), 1);
  assert.equal(await page.locator("#tree svg.ascii-diagram-svg, #code svg.ascii-diagram-svg, #table svg.ascii-diagram-svg, #inline svg.ascii-diagram-svg, #references svg.ascii-diagram-svg").count(), 0);
  assert.ok((await page.locator("#labels .ascii-diagram-labels").textContent())?.includes("C++a--b"));
  assert.equal(await page.locator("#references a").getAttribute("href"), "https://example.com");
  assert.match(await plain.innerText(), /说明：/);
  assert.match(await plain.innerText(), /这里是结语。/);
  const assistant = page.locator('#assistant article[aria-label="助手回复"]');
  const assistantSource = await page.evaluate(() => (window as any).asciiFixture.realAssistantDiagram as string);
  const assistantMessage = await page.evaluate(() => (window as any).asciiFixture.assistantMessage as string);
  await assistant.locator('svg.ascii-diagram-svg').waitFor();
  assert.match(await assistant.locator('.code-language').innerText(), /已对齐/);
  assert.match(await assistant.innerText(), /先拿锁，再读取本批数据/);
  await assistant.getByRole('button', { name: '原文', exact: true }).click();
  assert.equal(await assistant.locator('pre code').textContent(), assistantSource);
  await assistant.getByRole('button', { name: '美化', exact: true }).click();
  await assistant.getByRole('button', { name: '复制代码', exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), assistantSource);
  const usage = page.locator('#usage-panel');
  const usageSource = await page.evaluate(() => (window as any).asciiFixture.usagePanel as string);
  assert.equal(await usage.locator('svg.ascii-diagram-svg').count(), 3);
  assert.match(await usage.locator('.code-language').innerText(), /已对齐/);
  assert.match(await usage.innerText(), /更多筛选/);
  assert.match(await usage.innerText(), /调用明细/);
  await usage.getByRole('button', { name: '原文', exact: true }).click();
  assert.equal(await usage.locator('pre code').textContent(), usageSource);
  await usage.getByRole('button', { name: '美化', exact: true }).click();
  await usage.getByRole('button', { name: '复制代码', exact: true }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), usageSource);
  for (const [id, key] of [["form-wide", "wideForm"], ["form-medium", "mediumForm"], ["form-narrow", "narrowForm"]]) {
    const form = page.locator(`#${id}`);
    const source = await page.evaluate(key => (window as any).asciiFixture[key] as string, key);
    assert.equal(await form.locator('.ascii-diagram-fields rect').count(), 5);
    assert.equal(await form.locator('input, select, textarea, foreignObject').count(), 0);
    await form.getByRole('button', { name: '原文', exact: true }).click();
    assert.equal(await form.locator('pre code').textContent(), source);
    await form.getByRole('button', { name: '美化', exact: true }).click();
    await form.getByRole('button', { name: '复制代码', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), source);
  }
  const original = await page.evaluate(() => (window as any).asciiFixture.original as string);
  for (const section of [plain, fenced]) {
    await section.getByRole("button", { name: "复制代码", exact: true }).click();
    // A plain paragraph's final newline belongs to the source; fenced content
    // follows Marked's existing code-block convention (no delimiter newline).
    const expected = section === plain ? original + "\n" : original;
    assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n"), expected);
    await section.getByRole("button", { name: "原文", exact: true }).click();
    assert.equal(await section.locator("svg.ascii-diagram-svg").count(), 0);
    assert.equal(await section.locator("pre code").textContent(), expected);
    assert.equal(await section.locator("pre").evaluate(el => getComputedStyle(el).whiteSpace), "pre");
    await section.getByRole("button", { name: "美化", exact: true }).click();
    await section.locator("svg.ascii-diagram-svg").waitFor();
  }
  // Exercise keyboard activation, theme inheritance, scrolling instead of tiny
  // unreadable mobile scaling, and bounded document width.
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => (window as any).asciiFixture.setTheme(theme), theme);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1100 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${theme}/${width}: no page overflow`);
      const size = await fenced.locator("svg.ascii-diagram-svg").evaluate(el => ({
        width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height,
        expectedWidth: Number(el.getAttribute("width")), expectedHeight: Number(el.getAttribute("height")),
        stroke: getComputedStyle(el.querySelector("text")!).stroke,
      }));
      assert.ok(size.width > 450 && size.width < 535, `${theme}/${width}: compact SVG retains readable width: ${JSON.stringify(size)}`);
      assert.ok(size.height <= 112, "four-row layout must stay compact (was 160px)");
      assert.equal(size.width, size.expectedWidth, "global icon styles must not resize the diagram");
      assert.equal(size.height, size.expectedHeight);
      assert.equal(size.stroke, "none", "global icon strokes must not outline diagram labels");
      const naturalText = await page.locator(".ascii-diagram-labels text").evaluateAll(elements => {
        const ctx = document.createElement("canvas").getContext("2d")!;
        return elements.map(el => {
          const text = el as SVGTextElement;
          const style = getComputedStyle(el);
          // Font-feature settings can make the computed shorthand empty; an
          // empty canvas font silently retains its default 10px sans-serif.
          ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          return { fitted: el.hasAttribute("textLength") || el.hasAttribute("lengthAdjust"),
            delta: Math.abs(text.getComputedTextLength() - ctx.measureText(el.textContent ?? "").width),
            fontSize: getComputedStyle(el).fontSize };
        });
      });
      assert.ok(naturalText.length > 0);
      assert.ok(naturalText.every(text => !text.fitted && text.delta < 1 && text.fontSize === "14px"),
        `glyphs must retain natural proportions: ${JSON.stringify(naturalText)}`);
      if (width < 450) {
        assert.ok(await fenced.locator(".ascii-diagram-preview").evaluate(el => {
          el.scrollLeft = 100;
          const scrolls = el.scrollLeft > 0;
          el.scrollLeft = 0;
          return scrolls;
        }), "compact diagrams remain horizontally scrollable on mobile");
      }
      await fenced.getByRole("button", { name: "原文", exact: true }).focus();
      await page.keyboard.press("Enter");
      await fenced.locator("pre code").waitFor();
      await fenced.getByRole("button", { name: "美化", exact: true }).click();
      await fenced.locator("svg.ascii-diagram-svg").waitFor();
      const panelGeometry = await usage.locator('svg.ascii-diagram-svg').evaluateAll(elements => elements.map(el => {
        const paths = [...el.querySelectorAll('path')].map(p => p.getBBox());
        const labels = [...el.querySelectorAll('text')].map(t => ({text: t.textContent, box: t.getBBox()}));
        return labels.flatMap(label => paths.filter(line => !(label.box.x >= line.x + line.width + .2 || line.x >= label.box.x + label.box.width + .2 || label.box.y >= line.y + line.height + .2 || line.y >= label.box.y + label.box.height + .2)).map(() => label.text));
      }));
      assert.deepEqual(panelGeometry, [[], [], []], 'panel strokes must not cross labels');
      const panelLefts = await usage.locator('svg.ascii-diagram-svg').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().left));
      assert.ok(Math.max(...panelLefts) - Math.min(...panelLefts) < 1, 'mixed panels share the same left anchor rather than centering separately');
      if (width < 450) {
        for (const scroll of await usage.locator('.ascii-diagram-preview').all()) {
          assert.ok(await scroll.evaluate(el => {
            el.scrollLeft = el.scrollWidth;
            const rect = el.getBoundingClientRect(), svg = el.querySelector('svg')!.getBoundingClientRect();
            const reachable = svg.right <= rect.right + 1;
            el.scrollLeft = 0;
            return reachable;
          }), 'panel right edge is reachable by internal scrolling');
        }
      }
      for (const id of ['form-wide', 'form-medium', 'form-narrow']) {
        const form = page.locator(`#${id}`);
        const geometry = await form.locator('svg.ascii-diagram-svg').evaluate(el => {
          const fields = [...el.querySelectorAll('rect')].map(field => field.getBBox());
          const labels = [...el.querySelectorAll('text')].map(label => label.getBBox());
          const collisions = labels.some(label => fields.some(field => label.x < field.x + field.width && label.x + label.width > field.x && label.y < field.y + field.height && label.y + label.height > field.y));
          return { collisions, fill: getComputedStyle(el.querySelector('rect')!).fill, stroke: getComputedStyle(el.querySelector('rect')!).stroke };
        });
        assert.equal(geometry.collisions, false, `${id}: field borders do not cross labels`);
        assert.notEqual(geometry.fill, 'none');
        assert.notEqual(geometry.stroke, 'none');
        assert.ok(await form.locator('.ascii-diagram-preview').evaluate(el => {
          el.scrollLeft = el.scrollWidth;
          const reachable = el.querySelector('svg.ascii-diagram-svg')!.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1;
          el.scrollLeft = 0;
          return reachable;
        }), `${id}: right edge reachable`);
        await form.screenshot({ path: join(artifacts, `${id}-${theme}-${width}.png`) });
      }
      await usage.screenshot({ path: join(artifacts, `usage-panel-${theme}-${width}.png`) });
      await page.screenshot({ path: join(artifacts, `${theme}-${width}.png`), fullPage: true });
    }
  }
  await page.evaluate(() => (window as any).asciiFixture.setStreaming(true));
  await fenced.locator("pre").waitFor();
  assert.equal(await page.locator("#references a").getAttribute("href"), "https://example.com");
  assert.equal(await plain.locator("svg.ascii-diagram-svg").count(), 0);
  assert.equal(await fenced.getByRole("button", { name: "原文", exact: true }).count(), 0);
  assert.equal(await usage.locator('svg.ascii-diagram-svg').count(), 0);
  for (const id of ['form-wide', 'form-medium', 'form-narrow']) assert.equal(await page.locator(`#${id} .ascii-diagram-fields`).count(), 0);
  assert.equal(await usage.locator('pre code').textContent(), usageSource);
  assert.equal(await assistant.locator('svg.ascii-diagram-svg').count(), 0);
  assert.equal(await assistant.locator('pre code').textContent(), assistantSource);
  await page.evaluate(() => (window as any).asciiFixture.setStreaming(false));
  await fenced.locator("svg.ascii-diagram-svg").waitFor();
  await assistant.locator('svg.ascii-diagram-svg').waitFor();
  assert.equal(await usage.locator('svg.ascii-diagram-svg').count(), 3);
  for (const id of ['form-wide', 'form-medium', 'form-narrow']) assert.equal(await page.locator(`#${id} .ascii-diagram-fields rect`).count(), 5);
  assert.equal(await page.evaluate(() => (window as any).asciiFixture.assistantMessage), assistantMessage);
  assert.equal(await page.locator("#references a").getAttribute("href"), "https://example.com");
  await page.evaluate(() => (window as any).asciiFixture.setSource("┌──\n│尚未完成"));
  await fenced.locator("pre").waitFor();
  assert.equal(await fenced.locator("pre code").textContent(), "┌──\n│尚未完成");
  await page.evaluate(() => (window as any).asciiFixture.setSource((window as any).asciiFixture.original));
  await fenced.locator("svg.ascii-diagram-svg").waitFor();
  await page.evaluate(() => (window as any).asciiFixture.setSource(`+${"-".repeat(40)}+\n|${"<script>alert(1)</script> & safe".padEnd(40)}|\n+${"-".repeat(40)}+`));
  await page.waitForFunction(() => document.querySelector("#fenced .ascii-diagram-labels")?.textContent?.includes("<script>"));
  assert.equal(await fenced.locator("script, iframe, foreignObject, a").count(), 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, [], "no model or external rendering requests");
  console.log(`PASS: plain/fenced/ASCII/vertical, exact source toggle+clipboard, fallback/recovery, streaming, inert SVG, no external requests, 2 themes × 3 widths. Artifacts: ${artifacts}`);
} finally {
  await browser?.close(); await server.close(); await rm(root, { recursive: true, force: true });
}
