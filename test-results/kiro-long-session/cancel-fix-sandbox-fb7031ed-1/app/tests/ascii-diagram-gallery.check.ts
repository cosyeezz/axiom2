// Run from app/: AXIOM_TEST_BROWSER=/path/to/Chrome npx tsx tests/ascii-diagram-gallery.check.ts [before|after]
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { diagramCases } from "./fixtures/ascii-diagram-cases.js";
const phase = process.argv[2] ?? "after";
const root = await mkdtemp(join(tmpdir(), "axiom-ascii-gallery-"));
const appRoot = resolve("."), artifacts = resolve(`test-results/ascii-diagram-gallery/${phase}`);
await mkdir(artifacts, { recursive: true });
await writeFile(join(root, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs/${appRoot}/tests/fixtures/ascii-diagram-gallery.tsx"></script></body></html>`);
const server = await createServer({ configFile: false, root, cacheDir: join(root, "cache"), resolve: { alias: { react: join(appRoot, "node_modules/react"), "react-dom": join(appRoot, "node_modules/react-dom") } }, esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0, fs: { allow: [root, appRoot] } } });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, permissions: ["clipboard-read", "clipboard-write"] });
  const errors: string[] = [], external: string[] = [], results: unknown[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (!request.url().startsWith(server.resolvedUrls!.local[0])) external.push(request.url()); });
  await page.goto(server.resolvedUrls!.local[0]);
  await page.locator("#merge svg.ascii-diagram-svg").waitFor();
  for (const theme of phase === "before" ? ["light"] : ["light", "dark"]) {
    await page.evaluate(theme => (window as any).asciiGallery.setTheme(theme), theme);
    for (const width of phase === "before" ? [1440] : [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1100 });
      for (const test of diagramCases) {
        const section = page.locator(`#${test.id}`), preview = section.locator("svg.ascii-diagram-svg");
        const rendered = await preview.count() > 0;
        const detail = rendered ? await preview.evaluate(el => ({
          labels: [...el.querySelectorAll("text")].map(el => ({ text: el.textContent, x: el.getAttribute("x"), y: el.getAttribute("y"), width: (el as SVGTextElement).getComputedTextLength() })),
          svgWidth: el.getBoundingClientRect().width, svgHeight: el.getBoundingClientRect().height,
        })) : {};
        results.push({ id: test.id, theme, width, rendered, ...detail });
        if (width === 1440 || width === 390 || width === 320 && ["merge", "assistant-original", "offset-left", "offset-right", "offset-branch", "offset-ambiguous", "increments", "columns", "arrow-chain"].includes(test.id)) {
          await section.screenshot({ path: join(artifacts, `${theme}-${width}-${test.id}.png`) });
        }
        if (phase !== "before") {
          assert.equal(rendered, !test.fallback, `${test.id}: expected ${test.fallback ? "literal fallback" : "SVG"}`);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${test.id}/${width}: no page overflow`);
          if (rendered) {
            const svg = preview;
            const naturalRuns = await svg.locator("tspan").evaluateAll(elements => {
              const ctx = document.createElement("canvas").getContext("2d")!;
              return elements.map(el => {
                const style = getComputedStyle(el);
                ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                return { text: el.textContent, delta: Math.abs((el as SVGTSpanElement).getComputedTextLength() - ctx.measureText(el.textContent ?? "").width), fontSize: style.fontSize };
              });
            });
            assert.ok(naturalRuns.every(run => run.delta < 1 && run.fontSize === "14px"), `${test.id}: natural glyph metrics ${JSON.stringify(naturalRuns)}`);
            if (test.id === "columns") {
              const positions = await svg.locator("tspan").evaluateAll(elements => elements.filter(el => el.textContent === "A").map(el => {
                const b = (el as SVGTSpanElement).getBBox();
                return b.x + b.width / 2;
              }));
              assert.equal(positions.length, 2);
              assert.ok(Math.abs(positions[0] - positions[1]) < .5, "ASCII after CJK must align with same source column after ASCII");
            }
            if (test.id === "rounded") assert.equal(await svg.locator('path[d*="Q"]').count(), 4);
            if (test.id === "assistant-original") {
              assert.match(await section.locator('.code-language').innerText(), /已对齐/);
              const geometry = await svg.evaluate(el => {
                return { paths: [...el.querySelectorAll('path')].map(p => { const b = p.getBBox(); return { d: p.getAttribute('d'), x: b.x, y: b.y, width: b.width, height: b.height }; }),
                  labels: [...el.querySelectorAll('text')].map(t => { const b = t.getBBox(); return { text: t.textContent, x: b.x, y: b.y, width: b.width, height: b.height }; }) };
              });
              // Independently specified corrected columns: merge=20, branch=28.
              assert.ok(geometry.paths.some(p => p.d?.includes('M186.25,45L186.25,34') && p.d.includes('M186.25,45L186.25,56')), 'middle merge joins both fixed endpoints');
              assert.ok(geometry.paths.some(p => p.d?.includes('M254.25,89L254.25,78')), 'bottom branch meets the fixed upper branch');
              assert.ok(geometry.labels.find(t => t.text === '尝试获取整理锁（不等待）')!.x >= 199, 'merge label moves with its arrow, not under it');
              assert.ok(geometry.labels.find(t => t.text === '成功：读取本批数据')!.x >= 267, 'branch label moves with its stroke');
              for (const label of geometry.labels) {
                for (const line of geometry.paths) {
                  const disjoint = label.x >= line.x + line.width + .5 || line.x >= label.x + label.width + .5 || label.y >= line.y + line.height + .5 || line.y >= label.y + label.height + .5;
                  assert.ok(disjoint, `real assistant: line must not cross label ${label.text}`);
                }
              }
              assert.equal(await svg.locator('tspan').filter({ hasText: /^↓$/ }).count(), 3, 'isolated arrows are preserved, never joined by invented lines');
            }
            if (["ascii-math", "words", "literal-arrows", "increments"].includes(test.id)) {
              const text = await svg.locator(".ascii-diagram-labels").textContent();
              assert.equal(text, test.source.split("\n").slice(1, -1).map(line => line.slice(1, -1).replace(/\s/gu, "")).join(""), `${test.id}: every body character preserved`);
            }
            if (test.id === "arrow-chain") {
              assert.equal(await svg.locator('tspan').filter({ hasText: /^v$/ }).count(), 2, "unconfirmed v candidates stay body text");
            }
            if (width < 1440) {
              const scroll = section.locator(".ascii-diagram-preview");
              const reach = await scroll.evaluate(el => {
                const maximum = el.scrollWidth - el.clientWidth;
                el.scrollLeft = maximum;
                const bounds = el.getBoundingClientRect(), svgBounds = el.querySelector("svg")!.getBoundingClientRect();
                return { maximum, position: el.scrollLeft, endVisible: svgBounds.right <= bounds.right + 1 && svgBounds.right >= bounds.left };
              });
              if (test.id === 'assistant-original') assert.ok(reach.maximum > 1, 'real assistant remains readable and scrollable, not scaled down');
              if (reach.maximum > 1) {
                assert.ok(reach.position >= reach.maximum - 1 && reach.endVisible, `${test.id}/${width}: right edge reachable by internal scrolling`);
                if (["merge", "assistant-original"].includes(test.id)) await section.screenshot({ path: join(artifacts, `${theme}-${width}-${test.id}-scrolled-end.png`) });
              }
              await scroll.evaluate(el => { el.scrollLeft = 0; });
            }
            const textInfo = await svg.locator("text").evaluateAll(elements => elements.map(el => {
              const text = el as SVGTextElement, b = text.getBBox();
              const root = text.ownerSVGElement!, max = Number(root.getAttribute("width"));
              return { text: text.textContent, fitted: el.hasAttribute("textLength") || el.hasAttribute("lengthAdjust"), withinBounds: b.x >= 0 && b.x + b.width <= max + 1, stroke: getComputedStyle(el).stroke };
            }));
            assert.ok(textInfo.every(t => !t.fitted && t.withinBounds && t.stroke === "none"), `${test.id}: unclipped, natural text ${JSON.stringify(textInfo)}`);
            await section.getByRole("button", { name: "原文", exact: true }).click();
            assert.equal(await section.locator(".ascii-diagram-source code").textContent(), test.source);
            await section.getByRole("button", { name: "美化", exact: true }).click();
            await preview.waitFor();
          } else {
            const source = section.locator(".gallery-pair > div:last-child pre");
            assert.equal(await source.locator("code").textContent(), test.source, `${test.id}: intact fallback`);
            assert.equal(await source.evaluate(el => getComputedStyle(el).whiteSpace), "pre", `${test.id}: fallback must not wrap diagram rows`);
          }
          await section.getByRole("button", { name: "复制代码", exact: true }).click();
          assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n"), test.source, `${test.id}: exact original clipboard`);
        }
      }
    }
  }
  await writeFile(join(artifacts, "measurements.json"), JSON.stringify(results, null, 2));
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log(`PASS ${phase}: ${diagramCases.length} compositions; screenshots/measurements: ${artifacts}`);
} finally {
  await browser?.close(); await server.close(); await rm(root, { recursive: true, force: true });
}
