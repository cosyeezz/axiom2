import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";
import { Resources, type ResourceNpmExecute } from "../src/server/resources.js";
import type { OpenCliExecute } from "../src/server/integrations/opencli.js";

const root = mkdtempSync(join(tmpdir(), "axiom-resource-parallel-ui-")), pi = join(root, "shared");
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS ?? "test-results/resources-concurrency");
mkdirSync(pi, { recursive: true }); mkdirSync(artifacts, { recursive: true });
const previous = process.env.PI_CODING_AGENT_DIR, previousShared = process.env.AXIOM_PI_DIR;
process.env.PI_CODING_AGENT_DIR = pi; process.env.AXIOM_PI_DIR = pi;
const gates = new Map<string, () => void>();
function file(path: string, value: unknown) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value)); }
const execute: OpenCliExecute = async (args, options) => {
  const directory = args[args.indexOf("--prefix") + 1], name = args.at(-1)!;
  await new Promise<void>((resolve, reject) => {
    const signal = options!.signal!, abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    gates.set(name, () => { signal.removeEventListener("abort", abort); resolve(); });
    if (signal.aborted) abort();
  });
  const packageRoot = join(directory, "node_modules", name);
  file(join(packageRoot, "package.json"), { name, version: "1.0.0", bin: "index.js" });
  file(join(packageRoot, "index.js"), "// isolated fixture");
  return "";
};
const fixtureExecute: ResourceNpmExecute = async (args, options) => {
  // The browser fixture writes files in-process, without an npm child.
  try { return await execute(args, options); }
  finally { options.onStopped("not-started"); }
};
const original = Resources.prototype.command;
Resources.prototype.command = function(command) { Reflect.set(this, "execute", fixtureExecute); return original.call(this, command); };
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
const jobs = () => JSON.parse(readFileSync(join(root, "resources", "job.json"), "utf8")).jobs as { id: string; running: boolean; error?: string }[];
async function until(predicate: () => boolean) { for (let i = 0; i < 500; i++) { if (predicate()) return; await delay(10); } assert.fail("UI operation did not reach its expected state"); }
try {
  app = await startServer({ root, port: 0, dev: true, openCli: { locateNpm: () => { throw Error("isolated UI fixture: no npm discovery"); } } });
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER, headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } }), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${app.origin}/resources.html`);
  const mcpTab = page.getByRole("tab", { name: /^MCP/ }), skillTab = page.getByRole("tab", { name: /^技能/ });
  await mcpTab.click();
  async function install(name: string) {
    await page.locator("aside.supplier-panel").getByRole("button", { name: "添加 MCP", exact: true }).click();
    await page.locator("#resource-name").fill(name);
    await page.locator("#resource-source").fill(`fixture-${name}`);
    await page.getByRole("button", { name: "保存连接", exact: true }).click();
    await until(() => gates.has(`fixture-${name}`));
  }
  await install("first");
  assert.equal(await skillTab.isEnabled(), true); await skillTab.click(); await mcpTab.click();
  await install("second");
  assert.equal(jobs().filter(job => job.running).length, 2);
  await page.getByText("2 个资源任务正在处理；可以浏览和维护其他资源。", { exact: true }).waitFor();
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    for (const width of [320, 390, 1200]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator(".tools-feedback").scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${theme}/${width} overflow`);
      assert.equal(await skillTab.isEnabled(), true);
      await page.screenshot({ path: join(artifacts, `parallel-${theme}-${width}.png`), fullPage: true });
    }
  }
  await page.getByRole("button", { name: "任务记录", exact: true }).first().click();
  const center = page.getByRole("dialog", { name: "下载与维护", exact: true });
  await center.waitFor();
  assert.equal(await center.getByRole("link", { name: "来源页面" }).getAttribute("href"), "/resources.html");
  await center.getByRole("button", { name: "关闭下载与维护", exact: true }).click();
  await page.locator("aside.supplier-panel").getByRole("button", { name: "添加 MCP", exact: true }).click();
  const draft = `draft-${randomUUID().slice(0, 8)}`;
  await page.locator("#resource-name").fill(draft);
  await page.locator("#resource-config").fill('{"url":"https://example.invalid/mcp"}');
  gates.get("fixture-second")!();
  await until(() => jobs().filter(job => job.running).length === 1);
  await page.getByText("1 个资源任务正在处理；可以浏览和维护其他资源。", { exact: true }).waitFor();
  assert.equal(await page.locator("#resource-name").inputValue(), draft);
  assert.match(await page.locator("#resource-config").inputValue(), /example.invalid/);
  gates.get("fixture-first")!();
  await until(() => jobs().every(job => !job.running));
  await page.getByText("1 个资源任务正在处理；可以浏览和维护其他资源。", { exact: true }).waitFor({ state: "hidden" });
  assert.equal(await page.locator("#resource-name").inputValue(), draft);
  assert.ok(jobs().every(job => !job.error));
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(pi, "mcp.json"), "utf8")).mcpServers).sort(), ["first", "second"]);
  assert.equal(await page.getByRole("alert").count(), 0);
  await page.screenshot({ path: join(artifacts, "draft-preserved-after-completion.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, artifacts, cases: ["two concurrent real backend jobs", "navigation during installation", "dark/light 320/390/1200", "task center source link", "out-of-order completion preserves new form", "configuration and job records merge", "no page errors"] }));
} finally {
  await browser?.close();
  await app?.close();
  Resources.prototype.command = original;
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
  if (previousShared === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousShared;
  rmSync(root, { recursive: true, force: true });
}
