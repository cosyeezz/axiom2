import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { atomicProxyJson, proxyConfigPath, proxyDirectory, readProxyConfig } from "../src/server/integrations/model-proxy-config.js";
import { xrayImporterDirectory, xrayImporterRelease } from "../src/server/integrations/model-proxy-xray-installer.js";
const root = mkdtempSync(join(tmpdir(), "axiom-proxy-maintenance-ui-"));
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS ?? "test-results/proxy-maintenance"); mkdirSync(artifacts, { recursive: true });
const installation = { version: "1.0.0", directory: `xray-1.0.0-${randomUUID()}` };
mkdirSync(join(proxyDirectory(root), "versions", installation.directory), { recursive: true });
mkdirSync(xrayImporterDirectory(root), { recursive: true });
atomicProxyJson(proxyConfigPath(root), { revision: randomUUID(), installations: { xray: installation }, profiles: [], bindings: {} });
const app = await startServer({ root, port: 0, dev: true, openCli: { locateNpm: () => { throw Error("UI fixture: npm unavailable"); } } });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER, headless: true });
try {
  const page = await browser.newPage(), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${app.origin}/tools.html#model-proxy`);
  const proxy = page.locator("#model-proxy"), check = proxy.getByRole("button", { name: "核实本机版本", exact: true });
  await check.waitFor(); await page.waitForFunction(() => [...document.querySelectorAll("button")].some(b => b.textContent === "核实本机版本" && !b.disabled));
  await check.click();
  await proxy.getByText("发现文件，尚未核实", { exact: false }).waitFor();
  assert.equal(await proxy.getByText(/已核实 v/).count(), 0);
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    for (const width of [320, 390, 1200]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow: ${theme}/${width}`);
      const icons = await proxy.locator("svg use").evaluateAll(nodes => nodes.map(n => n.getAttribute("href")!).filter(href => !document.querySelector(href)));
      assert.deepEqual(icons, []);
      await page.screenshot({ path: join(artifacts, `proxy-${theme}-${width}.png`), fullPage: true });
    }
  }
  await proxy.getByRole("button", { name: "卸载导入组件", exact: true }).click();
  const confirm = proxy.getByRole("group", { name: "确认卸载 Xray 分享导入组件", exact: true });
  await confirm.waitFor(); assert.match(await confirm.innerText(), /现有线路、内核、订阅和供应商绑定保留/);
  await confirm.getByRole("button", { name: "暂不卸载" }).click();
  assert.ok(existsSync(xrayImporterDirectory(root)));
  await proxy.getByRole("button", { name: "卸载导入组件", exact: true }).click();
  await confirm.getByRole("button", { name: "确认卸载", exact: true }).click();
  await proxy.getByRole("button", { name: "安装导入组件", exact: true }).waitFor();
  assert.equal(existsSync(xrayImporterDirectory(root)), false);
  assert.deepEqual(readProxyConfig(root).installations.xray, installation);
  mkdirSync(xrayImporterDirectory(root), { recursive: true });
  writeFileSync(join(xrayImporterDirectory(root), xrayImporterRelease().asset), "corrupt cache");
  writeFileSync(join(xrayImporterDirectory(root), "xray-knife" + (process.platform === "win32" ? ".exe" : "")), "not executed");
  await check.click();
  await proxy.getByRole("alert").filter({ hasText: "压缩包校验失败" }).waitFor();
  assert.equal(await proxy.getByRole("alert").count(), 1, "one visible failure alert");
  assert.equal(await proxy.getByText(/已核实 v/).count(), 0);
  assert.equal(await proxy.getByRole("button", { name: "检查 Xray 更新", exact: true }).isEnabled(), true);
  await page.screenshot({ path: join(artifacts, "proxy-check-failed-light.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, artifacts, cases: ["dark/light 320/390/1200", "SVG icons", "empty directory not installed", "confirmation/cancel/uninstall", "kernel preserved", "corrupt cache check without repair", "single failure alert"] }));
} finally { await browser.close(); await app.close(); rmSync(root, { recursive: true, force: true }); }
