import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { atomicProxyJson, proxyConfigPath, proxyDirectory, readProxyConfig } from "../src/server/integrations/model-proxy-config.js";
import { xrayImporterDirectory, xrayImporterRelease } from "../src/server/integrations/model-proxy-xray-installer.js";
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS ?? "test-results/proxy-maintenance"); mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER, headless: true });
try {
  for (const withCore of [true, false]) {
    const root = mkdtempSync(join(tmpdir(), "axiom-proxy-maintenance-ui-"));
    const installation = { version: "1.0.0", directory: `xray-1.0.0-${randomUUID()}` };
    const core = join(proxyDirectory(root), "versions", installation.directory);
    if (withCore) mkdirSync(core, { recursive: true });
    mkdirSync(xrayImporterDirectory(root), { recursive: true });
    writeFileSync(join(xrayImporterDirectory(root), xrayImporterRelease().asset), "fixture cached download");
    atomicProxyJson(proxyConfigPath(root), { revision: randomUUID(), installations: withCore ? { xray: installation } : {}, profiles: [], bindings: {} });
    const app = await startServer({ root, port: 0, dev: true, openCli: { locateNpm: () => { throw Error("UI fixture: npm unavailable"); } } });
    const page = await browser.newPage(), errors: string[] = [];
    try {
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${app.origin}/tools.html#model-proxy`);
      const proxy = page.locator("#model-proxy");
      const remove = proxy.getByRole("button", { name: withCore ? "卸载内核" : "清理残留文件", exact: true });
      await remove.waitFor(); await page.waitForFunction(() => [...document.querySelectorAll("#model-proxy button")].some(b => /卸载内核|清理残留文件/.test(b.textContent || "") && !(b as HTMLButtonElement).disabled));
      for (const name of ["核实本机版本", "安装导入组件", "卸载导入组件", "修复固定兼容版本"]) assert.equal(await proxy.getByRole("button", { name, exact: true }).count(), 0);
      await proxy.getByRole("button", { name: "添加线路", exact: true }).click();
      await proxy.getByLabel("分享链接、订阅地址或配置内容", { exact: true }).fill("vless://fixture");
      assert.equal(await proxy.getByRole("button", { name: "识别节点", exact: true }).isEnabled(), withCore);
      if (!withCore) await proxy.getByText("请先在上方安装 Xray-core，再识别节点。", { exact: true }).waitFor();
      await proxy.getByRole("button", { name: "取消编辑", exact: true }).click();
      if (withCore) for (const theme of ["dark", "light"]) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        for (const width of [320, 390, 1200]) {
          await page.setViewportSize({ width, height: 900 });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow: ${theme}/${width}`);
          const icons = await proxy.locator("svg use").evaluateAll(nodes => nodes.map(n => n.getAttribute("href")!).filter(href => !document.querySelector(href)));
          assert.deepEqual(icons, []);
          await page.screenshot({ path: join(artifacts, `proxy-${theme}-${width}.png`), fullPage: true });
        }
      }
      const before = readProxyConfig(root);
      await remove.click();
      const confirm = proxy.getByRole("group", { name: "确认卸载 xray", exact: true });
      await confirm.waitFor(); assert.match(await confirm.innerText(), /及节点识别所需文件/);
      await confirm.getByRole("button", { name: "暂不卸载" }).click();
      assert.ok(existsSync(xrayImporterDirectory(root))); assert.deepEqual(readProxyConfig(root), before);
      await remove.click(); await confirm.getByRole("button", { name: "确认卸载", exact: true }).click();
      if (withCore && process.platform === "win32") {
        await proxy.getByRole("alert").filter({ hasText: "当前平台无法核实全部代理内核进程" }).waitFor();
        assert.equal(await proxy.getByRole("alert").count(), 1, "one visible failure alert");
        assert.ok(existsSync(core)); assert.ok(existsSync(xrayImporterDirectory(root))); assert.deepEqual(readProxyConfig(root), before);
      } else {
        await proxy.getByText("内核已卸载；相关线路已停止，订阅和供应商绑定保留。", { exact: true }).waitFor();
        assert.equal(existsSync(core), false); assert.equal(existsSync(xrayImporterDirectory(root)), false);
        assert.equal(readProxyConfig(root).installations.xray, undefined);
      }
      await page.screenshot({ path: join(artifacts, withCore ? "proxy-core-result.png" : "proxy-legacy-cleanup.png"), fullPage: true });
      assert.deepEqual(errors, []);
    } finally { await page.close(); await app.close(); rmSync(root, { recursive: true, force: true }); }
  }
  console.log(JSON.stringify({ passed: true, artifacts, cases: ["no independent importer controls", "core required for inspection", "dark/light 320/390/1200", "SVG icons", "combined confirmation and cancellation", "platform process checks", "legacy importer cleanup"] }));
} finally { await browser.close(); }
