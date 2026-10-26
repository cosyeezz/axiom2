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
      await page.screenshot({ path: join(artifacts, `${theme}-${width}.png`), fullPage: true });
    }
  }
  await page.evaluate(() => (window as any).asciiFixture.setStreaming(true));
  await fenced.locator("pre").waitFor();
  assert.equal(await page.locator("#references a").getAttribute("href"), "https://example.com");
  assert.equal(await plain.locator("svg.ascii-diagram-svg").count(), 0);
  assert.equal(await fenced.getByRole("button", { name: "原文", exact: true }).count(), 0);
  assert.equal(await assistant.locator('svg.ascii-diagram-svg').count(), 0);
  assert.equal(await assistant.locator('pre code').textContent(), assistantSource);
  await page.evaluate(() => (window as any).asciiFixture.setStreaming(false));
  await fenced.locator("svg.ascii-diagram-svg").waitFor();
  await assistant.locator('svg.ascii-diagram-svg').waitFor();
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
