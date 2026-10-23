import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { reaConfigPath } from "../src/server/integrations/rea-runtime.js";
import { listEngines } from "../src/server/integrations/rea-engines.js";
import { reaFixture } from "./rea-fixture.js";

const root = mkdtempSync(join(tmpdir(), "axiom-rea-engines-ui-")), fixture = reaFixture();
let checks = 0, installs = 0;
fixture.dependencies.checkEngines = async (_root, config) => { checks++; return listEngines(config).map(item => ({ ...item, checkedAt: Date.now(), status: item.path ? "ready" : item.status, detail: item.path ? "Fixture environment passed; no target loaded" : item.detail })); };
fixture.dependencies.prepareEngine = async (_root, id) => { installs++; const directory = join(root, `managed-${id}`); mkdirSync(directory); return { directory, path: directory }; };
const app = await startServer({ root, port: 0, rea: fixture.dependencies, openCli: { execute: async () => { throw Error("Excluded"); }, locateNpm: () => "unused" } });
const browser = await chromium.launch({ headless: true, executablePath: process.env.AXIOM_TEST_BROWSER });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
const output = resolve(process.env.AXIOM_REA_SCREENSHOTS ?? "test-results/rea-engines"); mkdirSync(output, { recursive: true });
try {
  await page.goto(app.origin + "/tools.html#rea");
  await page.getByRole("heading", { name: "分析引擎与配套组件" }).waitFor();
  const section = page.locator('[aria-labelledby="rea-engines-heading"]');
  assert.match(await section.innerText(), new RegExp(process.arch)); assert.equal(checks, 0); assert.equal(installs, 0);
  await page.getByRole("button", { name: "安装 REA", exact: true }).click();
  await page.getByText("REA 与技能已接入；已有会话请重新加载技能与 MCP。", { exact: true }).waitFor();
  const java = page.locator("#rea-path-java"), save = page.getByRole("button", { name: "保存JDK 21路径", exact: true });
  const path = join(root, "Configured JDK with spaces");
  await java.fill(path); await save.click();
  await page.getByText("组件路径已保存，请检测配套组件；已有会话需重新加载技能与 MCP。", { exact: true }).waitFor();
  assert.equal(JSON.parse(readFileSync(reaConfigPath(root), "utf8")).engines.java, path); assert.equal(checks, 0);
  await page.getByRole("button", { name: "检测配套组件", exact: true }).click();
  await page.getByText("组件检查完成；请查看各项状态，未启动分析目标。", { exact: true }).waitFor(); assert.equal(checks, 1);
  await page.reload(); await java.waitFor(); assert.equal(await java.inputValue(), path); assert.equal(checks, 1);
  await java.fill("relative-path"); await save.click();
  await page.locator("#rea .tools-feedback [role=alert]").filter({ hasText: "绝对路径" }).waitFor(); assert.equal(await java.inputValue(), "relative-path");
  await java.fill(path);
  await page.getByRole("button", { name: "安装JDK 21", exact: true }).click();
  await page.getByRole("button", { name: "暂不安装", exact: true }).click(); assert.equal(installs, 0);
  await page.getByRole("button", { name: "安装JDK 21", exact: true }).click();
  await page.getByRole("button", { name: "确认下载安装", exact: true }).click();
  await page.getByText("组件已安装并通过环境检查；已有会话请重新加载技能与 MCP。", { exact: true }).waitFor(); assert.equal(installs, 1);
  assert.equal(JSON.parse(readFileSync(reaConfigPath(root), "utf8")).engines.java, join(root, "managed-java"));
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await section.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, `overflow ${width}`);
    for (const button of await section.getByRole("button").all()) {
      const box = await button.boundingBox();
      assert.ok(box && box.height >= 44, `button ${await button.innerText()} target at ${width}: ${JSON.stringify(box)}; ${await button.evaluate(node => JSON.stringify({ display: getComputedStyle(node).display, height: getComputedStyle(node).height, minHeight: getComputedStyle(node).minHeight }))}`);
    }
    if ([390, 1440].includes(width)) await page.screenshot({ path: join(output, `engines-${width}.png`), fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log("REA engines UI passed: passive refresh, host display, save/persist/validate, explicit check, install confirmation and verified commit, 320/390/820/1440 layouts and 44px targets; no real engine downloads.");
} finally { await browser.close(); await app.close(); rmSync(root, { recursive: true, force: true }); }
