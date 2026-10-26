// Isolated real-component fixture. No real backend, model, process launch or user data.
// AXIOM_TEST_BROWSER=/path/to/chrome npx --no-install tsx tests/form-controls.check.ts
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { build } from "vite";
import { chromium } from "playwright";
import { WebSocketServer } from "ws";
import { displayTypography } from "../scripts/display-typography.js";
import { chooseSelect } from "./select-helpers.js";

const root = mkdtempSync(join(tmpdir(), "axiom-form-controls-"));
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS ?? "test-results/form-controls");
mkdirSync(artifacts, { recursive: true });
await build({ configFile: false, root: resolve("src/client"), logLevel: "warn", define: { "process.env.NODE_ENV": '"production"' },
  css: { postcss: { plugins: [displayTypography()] } },
  build: { outDir: root, emptyOutDir: true, minify: false, lib: { entry: resolve("tests/fixtures/form-controls.tsx"), name: "FormsFixture", formats: ["iife"], fileName: "fixture" } } });
const files = readdirSync(root), script = files.find(file => file.endsWith(".js"))!, css = files.find(file => file.endsWith(".css"))!;
writeFileSync(join(root, "index.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/${css}"></head><body><div id="root"></div><script src="/${script}"></script></body></html>`);
const server = createServer((req, res) => {
  if (req.url === "/api/status") { res.setHeader("Content-Type", "application/json"); res.end("{}"); return; }
  const file = req.url === "/" ? "index.html" : basename(new URL(req.url!, "http://fixture").pathname);
  if (![...files, "index.html"].includes(file)) { res.writeHead(404).end(); return; }
  res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript; charset=utf-8" : file.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8");
  res.end(readFileSync(join(root, file)));
});
const operations: string[] = [];
const sockets = new WebSocketServer({ server });
sockets.on("connection", socket => {
  socket.send(JSON.stringify({ type: "hello", streamId: "fixture" }));
  socket.on("message", raw => {
    const request = JSON.parse(String(raw)); operations.push(request.op);
    let data: unknown = {};
    if (request.op === "preview.describe") data = { root: "/isolated/fixture", revision: "fixture", scripts: [{ name: "long-project-start-script-".repeat(16), command: "fixture only; never executed" }] };
    if (request.op === "subscribe" && request.params.scope === "compression-preferences") socket.send(JSON.stringify({ type: "snapshot", scope: request.params.scope, streamId: "fixture", seq: 1, data: { auto: { enabled: true, tokens: 100000, percent: 80 } } }));
    if (request.op === "capabilities.get") data = { revision: "fixture", preferencesRevision: 1, state: { revision: 1, selection: { skills: [], mcp: [] } }, skills: [], mcp: [], mcpPaths: [], warnings: [], sessionSkillsEditable: true };
    socket.send(JSON.stringify({ type: "receipt", requestId: request.requestId, ok: true, data }));
  });
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const findings: string[] = [], results: unknown[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
  await page.getByRole("button", { name: "网页／项目运行", exact: true }).click();
  await page.getByRole("combobox", { name: "项目启动脚本", exact: true }).waitFor();
  for (const theme of ["dark", "light"]) for (const [viewport, width] of [[1440, 240], [1440, 320], [1440, 480], [320, 294], [390, 364], [820, 480]]) {
    await page.setViewportSize({ width: viewport as number, height: 1000 });
    await page.evaluate(({ theme, width }) => { document.documentElement.dataset.theme = theme; document.documentElement.style.setProperty("--sample-width", `${width}px`); }, { theme, width });
    await page.getByRole("button", { name: "技能与 MCP", exact: true }).click();
    // Constrain the actual portal independently of viewport: desktop split panes/zoom.
    await page.locator(".capability-settings").evaluate((node, width) => { (node as HTMLElement).style.width = `${width}px`; }, width);
    const checks = await page.evaluate(() => {
      const failures: string[] = [];
      for (const selector of ["#office-sample .file-office", ".file-web-actions", ".maintenance-budget", ".auto-compression-settings", ".processing-filters", ".capability-settings footer", "#checkbox-sample"]) {
        const node = document.querySelector<HTMLElement>(selector)!;
        if (node.scrollWidth > node.clientWidth + 2) failures.push(`${selector} overflows ${node.scrollWidth}/${node.clientWidth}`);
      }
      for (const node of document.querySelectorAll<HTMLElement>(".file-web-actions label, .file-office > label")) {
        const box = node.getBoundingClientRect(), parent = node.parentElement!.getBoundingClientRect();
        if (box.right > parent.right + 1) failures.push(`${node.textContent?.slice(0, 10)} label exceeds container`);
      }
      const footer = document.querySelector<HTMLElement>(".capability-settings footer small")!;
      if (footer.clientWidth < 120) failures.push(`capability summary crushed to ${footer.clientWidth}px`);
      for (const node of document.querySelectorAll<HTMLSelectElement>("select")) {
        const style = getComputedStyle(node);
        if (style.appearance !== "none" || style.backgroundImage === "none") failures.push(`native select not themed: ${node.getAttribute("aria-label") ?? node.parentElement?.textContent?.slice(0, 10)}`);
        if (parseFloat(style.minHeight) < 44) failures.push("native select target below 44px");
        if (style.color !== getComputedStyle(document.body).color) failures.push(`select foreground differs from theme: ${style.color}`);
      }
      for (const node of document.querySelectorAll<HTMLInputElement>("#checkbox-sample input, .file-web-actions input")) {
        if (node.getBoundingClientRect().width < 16) failures.push("checkbox shrinks below 16px");
        if (getComputedStyle(node).accentColor === "auto") failures.push("checkbox lacks theme accent");
      }
      const columns = getComputedStyle(document.querySelector(".auto-compression-fields")!).gridTemplateColumns.split(" ").length;
      if (document.querySelector("#auto-sample")!.clientWidth <= 320 && columns !== 1) failures.push("narrow auto compression remains two columns");
      return { failures, columns };
    });
    const key = `${theme}-${viewport}-${width}`;
    findings.push(...checks.failures.map(message => `${key}: ${message}`));
    results.push({ key, ...checks });
    if (width === 240 || viewport === 390) await page.screenshot({ path: join(artifacts, `${key}.png`), fullPage: true });
    await page.keyboard.press("Escape");
  }
  writeFileSync(join(artifacts, "results.json"), JSON.stringify({ findings, results, operations, errors }, null, 2));
  await page.getByRole("combobox", { name: "请求体类型", exact: true }).click();
  assert.ok(await page.getByRole("option", { name: "文本", exact: true }).locator("span").evaluate(node => {
    const style = getComputedStyle(node); return node.getBoundingClientRect().height < parseFloat(style.lineHeight) * 1.5;
  }), "80px trigger must not force a two-character option into a vertical column");
  await page.keyboard.press("Escape");
  await page.getByRole("combobox", { name: "Office 页或工作表", exact: true }).selectOption("1");
  assert.equal(await page.getByRole("combobox", { name: "Office 页或工作表", exact: true }).inputValue(), "1");
  const budgetTemplate = page.getByRole("combobox", { name: "时限模板", exact: true });
  await chooseSelect(page, budgetTemplate, "slow");
  assert.equal(await page.locator(".maintenance-budget-input input").first().inputValue(), "60");
  const pageOption = page.locator('[aria-label="网页运行模式"] option[value="page"]');
  assert.equal(await pageOption.evaluate(node => (node as HTMLOptionElement).disabled), true, "unavailable native option remains disabled");
  await page.getByRole("combobox", { name: "长选项", exact: true }).click();
  await page.keyboard.press("End"); await page.keyboard.press("Enter");
  assert.equal(await page.getByRole("combobox", { name: "长选项", exact: true }).innerText(), "短选项");
  await page.locator("#checkbox-sample input").first().check();
  assert.ok(await page.locator("#checkbox-sample input").first().isChecked());
  const providerId = page.getByRole("combobox", { name: "供应商 ID", exact: true });
  await providerId.fill("示例供应商");
  await page.getByRole("option", { name: "fixture-api · 示例供应商", exact: true }).click();
  assert.equal(await providerId.inputValue(), "fixture-api", "suggestion commits only ID, not display label");
  assert.equal(await page.locator("#provider-name").inputValue(), "示例供应商", "template still fills connection fields");
  await providerId.fill("my-custom-provider"); await page.keyboard.press("Tab");
  assert.equal(await providerId.inputValue(), "my-custom-provider", "freeform IDs remain editable");
  await page.locator("#lock-provider").click();
  assert.equal(await page.locator("#provider-id").evaluate(node => (node as HTMLInputElement).readOnly), true, "saved provider ID remains read-only");
  assert.equal(await page.getByRole("button", { name: "供应商 ID备选项", exact: true }).count(), 0);
  await page.emulateMedia({ forcedColors: "active" });
  assert.equal(await page.getByRole("combobox", { name: "Office 页或工作表", exact: true }).evaluate(node => getComputedStyle(node).appearance), "auto", "high contrast keeps native select affordance");
  await budgetTemplate.click();
  assert.equal(await page.getByRole("listbox").locator(".select-option.is-active").evaluate(node => getComputedStyle(node).outlineStyle), "solid", "high contrast identifies the active themed template option");
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, [], "no browser exceptions");
  assert.ok(!operations.includes("preview.start"), "no real project process started");
  writeFileSync(join(artifacts, "results.json"), JSON.stringify({ findings, results, operations, errors }, null, 2));
  assert.deepEqual(findings, [], "layout and control appearance regressions");
  console.log(`PASS form controls: 12 theme/viewport/container combinations; long names, native selections/disabled options, checkbox and custom Select keyboard. ${artifacts}`);
} finally {
  await browser.close();
  sockets.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
}
