// Run: AXIOM_TEST_BROWSER=/path/to/chrome npx tsx tests/code-block.check.ts
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = await mkdtemp(join(tmpdir(), "axiom-code-block-"));
const appRoot = resolve("."), artifacts = resolve(process.env.AXIOM_CODE_ARTIFACTS || "test-results/code-block");
await mkdir(artifacts, { recursive: true });
await writeFile(join(root, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs/${appRoot}/tests/fixtures/code-block.tsx"></script></body></html>`);
const server = await createServer({ configFile: false, root, cacheDir: join(root, "cache"), resolve: { alias: { react: join(appRoot, "node_modules/react"), "react-dom": join(appRoot, "node_modules/react-dom") } }, esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0, fs: { allow: [root, appRoot] } } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const page = await browser.newPage({ permissions: ["clipboard-read", "clipboard-write"] });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(server.resolvedUrls!.local[0]);
  const sql = page.locator("#sql"), json = page.locator("#json"), mermaid = page.locator("#mermaid");
  await sql.locator(".tok-keyword").first().waitFor();
  await json.locator(".tok-attr").first().waitFor();
  const originalSql = await sql.locator("pre").innerText(), originalJson = await json.locator("pre").innerText();
  for (const [section, original] of [[sql, originalSql], [json, originalJson]] as const) {
    await section.getByRole("button", { name: "格式化", exact: true }).click();
    await section.getByRole("button", { name: "还原", exact: true }).waitFor();
    const formatted = await section.locator("pre").innerText();
    assert.ok(formatted.includes("\n")); assert.ok(formatted.includes("hello  world"));
    await section.getByRole("button", { name: "复制代码", exact: true }).click();
    assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n"), formatted);
    await section.getByRole("button", { name: "压缩", exact: true }).click();
    await page.waitForFunction(id => document.querySelector(`${id} pre`)?.getAttribute("aria-busy") === "false", `#${await section.getAttribute("id")}`);
    const compact = await section.locator("pre").innerText();
    assert.ok(compact.includes("hello  world"));
    if (section === json) { assert.equal(compact, original); assert.ok(compact.includes("9007199254740993123")); }
    else { assert.ok(compact.includes("-- keep\nselect 2;")); assert.ok(compact.length < formatted.length); }
    // Compression may already restore the original lexemes for JSON.
    if (await section.getByRole("button", { name: "还原", exact: true }).count()) await section.getByRole("button", { name: "还原", exact: true }).click();
    assert.equal(await section.locator("pre").innerText(), original);
  }
  await page.evaluate(() => (window as any).codeFixture.setJson('{"partial":'));
  await json.getByRole("button", { name: "格式化", exact: true }).click();
  await json.getByRole("status").filter({ hasText: "格式化失败" }).waitFor();
  assert.equal(await json.locator("pre").innerText(), '{"partial":');
  await page.evaluate(() => (window as any).codeFixture.setJson('{"new":1}'));
  await json.locator(".tok-number").waitFor();
  assert.equal(await json.locator(".code-notice").count(), 0);
  await json.getByRole("button", { name: "格式化", exact: true }).click();
  await json.getByRole("button", { name: "还原", exact: true }).waitFor();
  await page.evaluate(() => (window as any).codeFixture.setJson('{"streamed":2}'));
  await page.waitForFunction(() => document.querySelector("#json pre")?.textContent === '{"streamed":2}');
  assert.equal(await json.getByRole("button", { name: "还原", exact: true }).count(), 0);
  const image = mermaid.getByRole("img", { name: "Mermaid 图表" });
  await image.waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => document.querySelector<HTMLImageElement>("#mermaid img")?.naturalWidth! > 0);
  const darkImage = await image.getAttribute("src");
  assert.ok(decodeURIComponent(darkImage!).includes("开始"));
  await mermaid.getByRole("button", { name: "源码", exact: true }).click();
  assert.match(await mermaid.locator("pre").innerText(), /^flowchart LR/);
  await mermaid.getByRole("button", { name: "图表", exact: true }).click();
  await image.waitFor();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(theme => (window as any).codeFixture.setTheme(theme), theme);
    await image.waitFor();
    if (theme === "light") assert.notEqual(await image.getAttribute("src"), darkImage);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `fits ${width}`);
      assert.ok(await sql.getByRole("button", { name: "格式化", exact: true }).isVisible());
      assert.ok(await image.evaluate(img => img.getBoundingClientRect().width > 50));
      assert.equal(await page.locator(".code-card").count(), 4);
      // Let image decoding and viewport repaint settle before full-page capture.
      await image.evaluate(async img => {
        await (img as HTMLImageElement).decode();
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      await page.screenshot({ path: join(artifacts, `${theme}-${width}.png`), fullPage: true });
    }
  }
  await page.evaluate(() => (window as any).codeFixture.setDiagram("flowchart LR\n A["));
  await mermaid.getByRole("status").filter({ hasText: "暂时无法绘制" }).waitFor();
  assert.match(await mermaid.locator("pre").innerText(), /A\[/);
  await page.evaluate(() => (window as any).codeFixture.setDiagram('sequenceDiagram\n Alice->>Bob: Hello'));
  await image.waitFor();
  await page.evaluate(() => (window as any).codeFixture.setDiagram('flowchart LR\n A["<img src=x onerror=alert(1)>"] --> B[Safe]\n click B "javascript:alert(1)"'));
  await image.waitFor();
  assert.equal(await mermaid.locator("a, iframe, script").count(), 0);
  assert.equal(await page.locator('body > div[id^="daxiom-mermaid"]').count(), 0);
  assert.equal(await page.locator("#ordinary .code-action").count(), 0);
  assert.deepEqual(errors, []);
  console.log(`PASS: SQL/JSON highlighting, transforms, exact clipboard, precision, error recovery, source updates; Mermaid preview/source, themes, 3 widths, invalid/recovered diagrams, inert SVG. Artifacts: ${artifacts}`);
} finally { await browser.close(); await server.close(); await rm(root, { recursive: true, force: true }); }
