import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { reaConfigPath, reaDirectory } from "../src/server/integrations/rea-runtime.js";
import { writeReaPackage } from "./rea-fixture.js";

// Built-in resources used to carry a trailing "内置" tag. They now share one
// Lucide `package` mark that stays grey for the packaged source and turns amber
// when the packaged copy is unavailable and a same-name general resource is used.
const root = mkdtempSync(join(tmpdir(), "axiom-builtin-mark-")), cwd = join(root, "project"), pi = join(root, "pi"), artifacts = resolve("test-results/builtin-mark");
for (const path of [cwd, pi, join(root, ".agents", "skills", "reverse-engineer-anything"), artifacts]) mkdirSync(path, { recursive: true });
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = pi;
writeFileSync(join(root, ".agents", "skills", "reverse-engineer-anything", "SKILL.md"), "---\nname: reverse-engineer-anything\ndescription: 外部同名技能\n---\nbody");
const installation = `v6.7.0-${randomUUID()}`;
writeReaPackage(join(reaDirectory(root), "versions", installation, "node_modules/rea-agents"), "6.7.0");
mkdirSync(reaDirectory(root), { recursive: true });
const config = (skillInstalled = true, mcpInstalled = true) => writeFileSync(reaConfigPath(root), JSON.stringify({ format: 1, revision: randomUUID(), enabled: true, skillInstalled, mcpInstalled,
  installation: { directory: installation, version: "6.7.0" } }));
config();
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const errors: string[] = [];
try {
  app = await startServer({ root, port: 0, dev: true });
  const workspace = app.store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: cwd, authorized: true } }) as any;
  const session = app.store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id }) as any;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  await context.addInitScript(view => sessionStorage.setItem("view", JSON.stringify(view)), scope);
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(app.accessUrl);
  await page.waitForFunction(() => document.querySelector(".connection-status")?.getAttribute("data-connected") === "true");
  await page.getByRole("button", { name: "技能与 MCP", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "技能与 MCP", exact: true });
  const row = (name: string) => dialog.locator(".capability-item").filter({ hasText: name });
  const mark = row("reverse-engineer-anything").locator(".builtin-mark");
  await mark.waitFor();
  assert.equal(await mark.getAttribute("role"), "img");
  assert.equal(await mark.getAttribute("aria-label"), "随 REA 安装包内置提供");
  assert.equal(await mark.getAttribute("data-tooltip"), "随 REA 安装包内置提供");
  assert.equal(await mark.locator("use").getAttribute("href"), "#i-builtin");
  assert.ok(!(await row("reverse-engineer-anything").locator(".capability-choice > span").innerText()).includes("内置"), "the name line carries no visible 内置 tag");
  const [nameBox, markBox, packed] = await Promise.all([row("reverse-engineer-anything").locator("strong").boundingBox(), mark.boundingBox(), mark.evaluate(node => getComputedStyle(node).color)]);
  assert.ok(Math.abs(markBox!.width - 13) < 0.6 && Math.abs(markBox!.height - 13) < 0.6, `mark is 13px: ${JSON.stringify(markBox)}`);
  assert.ok(Math.abs(markBox!.x - (nameBox!.x + nameBox!.width) - 6) < 1.5, "mark keeps a 6px gap after the name");
  assert.ok(Math.abs(markBox!.y + markBox!.height / 2 - (nameBox!.y + nameBox!.height / 2)) < 2.5, "mark centers on the name line");
  await mark.hover();
  await page.locator(".axiom-tooltip").filter({ hasText: "随 REA 安装包内置提供" }).waitFor();
  await page.screenshot({ path: join(artifacts, "capability-packaged.png") });
  await dialog.getByRole("button", { name: /^MCP / }).click();
  const mcpMark = dialog.locator(".capability-item").filter({ hasText: /^rea/ }).first().locator(".builtin-mark");
  await mcpMark.waitFor();
  assert.equal(await mcpMark.getAttribute("aria-label"), "随 REA 安装包内置提供");
  assert.equal(await dialog.locator(".capability-item").filter({ hasText: "fixture-mcp" }).locator(".builtin-mark").count(), 0, "general resources carry no builtin mark");
  // Settings page reuses the same mark for the packaged MCP and its detail row.
  await page.goto(app.origin + "/settings.html");
  await page.getByRole("link", { name: "技能与 MCP", exact: true }).click();
  await page.getByRole("tab", { name: /^MCP/ }).click();
  const mcpOption = page.locator(".supplier-option").filter({ hasText: "REA 内置 MCP 服务" });
  const optionMark = mcpOption.locator(".builtin-mark");
  await optionMark.waitFor();
  assert.equal(await optionMark.getAttribute("aria-label"), "随 REA 安装包内置提供");
  assert.ok(!(await mcpOption.locator("strong").innerText()).includes("内置"), "the settings row name carries no visible 内置 tag");
  assert.doesNotMatch(await mcpOption.locator("small").last().innerText(), /应用安装|本机配置/, "the packaged row drops the installation wording");
  await mcpOption.click();
  await page.getByText("随 REA 安装包提供", { exact: true }).waitFor();
  const headingMark = page.locator(".detail-heading h2 .builtin-mark");
  assert.equal(await headingMark.getAttribute("aria-label"), "随 REA 安装包内置提供");
  const headingBox = await headingMark.boundingBox();
  assert.ok(headingBox && Math.abs(headingBox.width - 15) < 0.6 && Math.abs(headingBox.height - 15) < 0.6, "detail heading mark is 15px");
  const factMark = page.locator(".resources-facts .builtin-mark");
  assert.equal(await factMark.getAttribute("aria-label"), "随 REA 安装包内置提供");
  await page.screenshot({ path: join(artifacts, "resources-packaged.png"), fullPage: true });
  // Uninstalling the packaged skill leaves the general copy; the mark keeps identifying
  // that the packaged source is missing instead of silently passing as built in.
  config(false, true);
  await page.goto(app.accessUrl);
  await page.waitForFunction(() => document.querySelector(".connection-status")?.getAttribute("data-connected") === "true");
  await page.getByRole("button", { name: "技能与 MCP", exact: true }).click();
  const fallback = dialog.locator(".capability-item").filter({ hasText: "reverse-engineer-anything" }).locator(".builtin-mark");
  await fallback.waitFor();
  assert.ok((await fallback.getAttribute("class"))!.includes("is-fallback"));
  assert.equal(await fallback.getAttribute("aria-label"), "内置 REA 未加载，当前使用通用同名来源");
  assert.notEqual(await fallback.evaluate(node => getComputedStyle(node).color), packed, "the fallback mark is not the neutral packaged color");
  await fallback.hover();
  await page.locator(".axiom-tooltip").filter({ hasText: "内置 REA 未加载" }).waitFor();
  await page.screenshot({ path: join(artifacts, "capability-fallback.png") });
  assert.deepEqual(errors, []);
  console.log(`Built-in mark passed: capabilities and settings marks, 13px geometry, tooltips, no visible 内置 tag, packed/fallback color split. Artifacts: ${artifacts}`);
} finally {
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  await browser?.close(); await app?.close(); rmSync(root, { recursive: true, force: true });
}
