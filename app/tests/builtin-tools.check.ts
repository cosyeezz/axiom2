import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { openCliSkillNames, openCliConfigPath } from "../src/server/integrations/opencli-runtime.js";
import type { OpenCliExecute } from "../src/server/integrations/opencli.js";

const root = mkdtempSync(join(tmpdir(), "axiom-tools-ui-"));
const prefix = join(root, "global"), modules = join(prefix, "node_modules"), packageRoot = join(modules, "@jackwener", "opencli");
let release!: () => void, installs = 0;
const gate = new Promise<void>((r) => { release = r; });
const execute: OpenCliExecute = async (args) => {
  if (args[1] === "--version") return "11.0.0";
  if (args[1] === "root") return modules;
  if (args[1] === "prefix") return prefix;
  if (args[1] === "view") return '"1.8.8"';
  if (args[1] === "doctor") return "[OK] Daemon: running\n[MISSING] Extension: not connected\nBrowser connectivity test failed";
  if (args[1] === "install") {
    installs++; await gate;
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "@jackwener/opencli", version: "1.8.8", bin: { opencli: "cli.js" } }));
    writeFileSync(join(packageRoot, "cli.js"), "// fixture");
    for (const name of openCliSkillNames) {
      mkdirSync(join(packageRoot, "skills", name), { recursive: true });
      writeFileSync(join(packageRoot, "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: Fixture\n---\nGuide`);
    }
    return "installed";
  }
  throw Error("Unexpected fixture command");
};
const app = await startServer({ root, port: 0, openCli: { execute, locateNpm: () => "npm-cli.js" } });
const browser = await chromium.launch({ headless: true, executablePath: process.env.AXIOM_TEST_BROWSER });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(app.origin + "/settings.html");
  await page.getByRole("link", { name: "内置工具", exact: true }).click();
  await page.getByRole("button", { name: "检查更新", exact: true }).waitFor();
  await page.waitForFunction(() => !(document.querySelectorAll(".tools-actions button")[0] as HTMLButtonElement).disabled);
  assert.equal(await page.getByRole("button", { name: "安装 OpenCLI", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "检查更新", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent === "安装 OpenCLI" && !b.disabled));
  await page.getByRole("button", { name: "安装 OpenCLI", exact: true }).click();
  await page.getByRole("button", { name: "正在安装…", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "正在安装…", exact: true }).waitFor();
  assert.equal(installs, 1);
  release();
  await page.waitForFunction(() => document.body.innerText.includes("安装与技能接入已完成"));
  await page.getByLabel("Chrome 配置档案", { exact: true }).fill("work-profile");
  await page.getByLabel("浏览器窗口", { exact: true }).selectOption("background");
  await page.getByRole("button", { name: "检查环境", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent === "保存接入设置" && !b.disabled));
  assert.equal(await page.getByLabel("Chrome 配置档案", { exact: true }).inputValue(), "work-profile", "status updates preserve input");
  await page.getByRole("button", { name: "保存接入设置", exact: true }).click();
  await page.getByText("接入设置已保存，将在下一次 Agent 执行时加载。", { exact: true }).waitFor();
  assert.equal(JSON.parse(readFileSync(openCliConfigPath(root), "utf8")).profile, "work-profile");
  await page.reload();
  await page.waitForFunction(() => (document.getElementById("opencli-profile") as HTMLInputElement)?.value === "work-profile");
  assert.equal(await page.getByLabel("浏览器窗口", { exact: true }).inputValue(), "background");
  await page.getByRole("button", { name: "检测连接", exact: true }).click();
  await page.getByText("[OK] Daemon: running", { exact: false }).waitFor();
  assert.ok((await page.locator(".tools-diagnostic").innerText()).includes("[MISSING]"));
  assert.ok(!(await page.locator(".tools-feedback").innerText()).includes("连接成功"));
  mkdirSync(resolve("test-results"), { recursive: true });
  for (const [width, height] of [[360, 800], [390, 844], [430, 932], [600, 960], [820, 1180], [1024, 768], [1366, 768], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    assert.equal(overflow, false, `horizontal overflow at ${width}`);
    if ([360, 1440].includes(width)) await page.screenshot({ path: resolve(`test-results/builtin-tools-${width}.png`), fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log("Built-in tools UI passed: install/reload, persisted settings, draft preservation, diagnostics, nine responsive widths.");
} finally { release(); await browser.close(); await app.close(); rmSync(root, { recursive: true, force: true }); }
