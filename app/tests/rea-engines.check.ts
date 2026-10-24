import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "./temporary.js";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { reaConfigPath } from "../src/server/integrations/rea-runtime.js";
import { listEngines } from "../src/server/integrations/rea-engines.js";
import { openHopperInstaller, prepareEngineDownload } from "../src/server/integrations/rea-engine-download.js";
import { fixtureEngineRelease, reaFixture } from "./rea-fixture.js";

const root = mkdtempSync(join(tmpdir(), "axiom-rea-engines-ui-")), fixture = reaFixture();
let checks = 0, installs = 0, downloads = 0, installers = 0;
const versions = { ghidra: "12.1.4", hopper: "6.6.0" };
const packageData = (id: string, version: string) => Buffer.from(`fixture ${id} ${version} package`);
function downloadGate() {
  let release!: () => void, enter!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { enter = resolve; });
  return { release, entered, wait: async (signal: AbortSignal) => {
    signal.throwIfAborted(); enter();
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      void released.then(resolve).finally(() => signal.removeEventListener("abort", abort));
    });
    signal.throwIfAborted();
  } };
}
const downloadGates = new Map<string, ReturnType<typeof downloadGate>>();
fixture.dependencies.checkEngines = async (_root, config) => { checks++; return listEngines(config).map(item => ({ ...item, checkedAt: Date.now(), status: item.path && item.status !== "missing" ? "ready" : item.status })); };
fixture.dependencies.engineRelease = async id => {
  const release = await fixtureEngineRelease(id);
  if (id === "java") return { ...release, version: "21.0.13+9.0.LTS" };
  if (id !== "hopper" && id !== "ghidra") return release;
  const version = versions[id], data = packageData(id, version);
  return { ...release, version, url: id === "hopper" ? `https://www.hopperapp.com/downloader/public/Hopper-${version}-demo.dmg` : `https://github.com/fixture/ghidra/${version}.zip`, size: data.length, ...(id === "hopper" ? { sha1: createHash("sha1").update(data).digest("hex") } : { sha256: createHash("sha256").update(data).digest("hex") }) };
};
fixture.dependencies.prepareEngine = async (_root, id, _signal, _notify, _fetcher, release, options) => {
  installs++; const directory = join(root, "integrations", "rea", "engines", `${id}-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  if (id === "ghidra") {
    assert.equal(options?.cachedOnly, true);
    mkdirSync(join(directory, "Ghidra")); writeFileSync(join(directory, "Ghidra", "application.properties"), `application.version=${release!.version}\n`);
  } else writeFileSync(join(directory, "release"), 'JAVA_RUNTIME_VERSION="21.0.13+9-LTS"\n');
  return { directory, path: directory };
};
fixture.dependencies.openHopperInstaller = (root, record, signal) => openHopperInstaller(root, record, signal, async (file, args) => {
  assert.equal(file, "/usr/bin/open"); assert.match(args[0], /package\.dmg$/); installers++;
  return { code: 0, stdout: "", stderr: "" };
});
fixture.dependencies.prepareEngineDownload = async (root, id, release, signal, notify) => {
  downloads++;
  return prepareEngineDownload(root, id, release, signal, notify, async () => {
    await downloadGates.get(id)?.wait(signal); return new Response(packageData(id, release.version));
  });
};
const app = await startServer({ root, port: 0, dev: true, rea: fixture.dependencies, openCli: { execute: async () => { throw Error("Excluded"); }, locateNpm: () => "unused" } });
const browser = await chromium.launch({ headless: true, executablePath: process.env.AXIOM_TEST_BROWSER });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
const output = resolve(process.env.AXIOM_REA_SCREENSHOTS ?? "test-results/rea-engines"); mkdirSync(output, { recursive: true });
const savedConfig = () => JSON.parse(readFileSync(reaConfigPath(root), "utf8"));
try {
  await page.goto(app.origin + "/tools.html#rea");
  await page.getByRole("heading", { name: "分析引擎与配套组件" }).waitFor();
  const section = page.locator('[aria-labelledby="rea-engines-heading"]');
  assert.match(await section.innerText(), new RegExp(process.arch)); assert.equal(checks, 0); assert.equal(installs, 0);
  assert.equal(await section.locator("input").count(), 0, "component paths use defaults without input fields");
  await page.getByRole("button", { name: "安装 REA", exact: true }).click();
  await page.getByText("REA 与技能已接入；已有会话请重新加载技能与 MCP。", { exact: true }).waitFor();
  const java = section.getByRole("region", { name: "JDK 21维护", exact: true });
  await java.getByRole("button", { name: "检查JDK 21更新", exact: true }).click();
  await java.getByText("21.0.13+9.0.LTS", { exact: true }).waitFor();
  await java.getByRole("button", { name: /^(安装|更新|切换推荐版)JDK 21$/ }).click();
  await java.getByRole("button", { name: "暂不安装", exact: true }).click(); assert.equal(installs, 0);
  await java.getByRole("button", { name: /^(安装|更新|切换推荐版)JDK 21$/ }).click();
  await java.getByRole("button", { name: "确认下载安装", exact: true }).click();
  await java.getByText("已是推荐版本", { exact: true }).waitFor(); assert.equal(installs, 1);
  assert.match(savedConfig().engines.java, /integrations\/rea\/engines\/java-/);
  await java.getByRole("button", { name: "检查JDK 21更新", exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '检查JDK 21更新' && !(button as HTMLButtonElement).disabled));
  assert.equal(await java.getByRole("button", { name: /^(安装|更新|重新安装|修复|切换推荐版)JDK 21$/ }).count(), 0, "equivalent JDK versions do not offer another download");
  const ghidra = section.getByRole("region", { name: "Ghidra维护", exact: true }), hopper = section.getByRole("region", { name: "Hopper维护", exact: true });
  const panelFor = (id: "ghidra" | "hopper") => id === "ghidra" ? ghidra : hopper;
  const labelFor = (id: "ghidra" | "hopper") => id === "ghidra" ? "Ghidra" : "Hopper";
  const prepareDownload = async (id: "ghidra" | "hopper") => {
    const panel = panelFor(id), label = labelFor(id);
    assert.equal(await panel.getByRole("button", { name: `检查${label}更新`, exact: true }).isEnabled(), true, `${label} can check while another component downloads`);
    await panel.getByRole("button", { name: `检查${label}更新`, exact: true }).click();
    await panel.getByRole("button", { name: `下载${label}安装包`, exact: true }).click();
    return panel.getByRole("group", { name: `确认下载${label}`, exact: true });
  };
  if (process.platform === "darwin") {
    for (const id of ["ghidra", "hopper"] as const) {
      const panel = panelFor(id), label = labelFor(id);
      assert.equal(await panel.getByRole("button", { name: `下载${label}安装包`, exact: true }).isDisabled(), true);
      const confirm = await prepareDownload(id);
      assert.match(await confirm.innerText(), /下载后可继续安装/);
      await confirm.getByRole("button", { name: "暂不下载", exact: true }).click();
      const before = downloads;
      await panel.getByRole("button", { name: `下载${label}安装包`, exact: true }).click();
      await confirm.getByRole("button", { name: "确认下载", exact: true }).click();
      await panel.getByText("已下载 · 待安装", { exact: true }).waitFor(); assert.equal(downloads, before + 1);
      assert.equal(savedConfig().engines[id], undefined);
      await panel.getByRole("button", { name: "查看安装包", exact: true }).waitFor();
      assert.equal(await panel.getByRole("button", { name: `下载${label}安装包`, exact: true }).count(), 0);
      await panel.getByRole("button", { name: `检查${label}更新`, exact: true }).click();
      await page.waitForFunction(label => [...document.querySelectorAll('button')].some(button => button.textContent === `检查${label}更新` && !(button as HTMLButtonElement).disabled), label);
      assert.equal(downloads, before + 1); assert.equal(await panel.getByRole("button", { name: `下载${label}安装包`, exact: true }).count(), 0);
      await panel.getByRole("button", { name: `安装${label}`, exact: true }).click();
      const installConfirm = panel.getByRole("group", { name: `确认安装${label}`, exact: true });
      if (id === "ghidra") assert.match(await installConfirm.innerText(), /已下载的安装包.*JDK 21.*Xcode/s);
      else assert.match(await installConfirm.innerText(), /后台 Mac.*系统窗口/);
      if (id === "hopper") {
        versions.hopper = "6.6.1";
        await panel.getByRole("button", { name: "检查Hopper更新", exact: true }).click();
        await installConfirm.getByText("此组件或安装版本已变化，请重新确认。", { exact: true }).waitFor();
        assert.equal(await installConfirm.getByRole("button", { name: "打开安装程序", exact: true }).isDisabled(), true);
        versions.hopper = "6.6.0";
        await panel.getByRole("button", { name: "检查Hopper更新", exact: true }).click();
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '打开安装程序' && !(button as HTMLButtonElement).disabled));
      }
      await installConfirm.getByRole("button", { name: "暂不安装", exact: true }).click();
      assert.equal(installs, id === "ghidra" ? 1 : 2); assert.equal(installers, 0);
      await page.reload(); await panel.getByRole("button", { name: `安装${label}`, exact: true }).click();
      await installConfirm.getByRole("button", { name: id === "ghidra" ? "确认安装" : "打开安装程序", exact: true }).click();
      await panel.getByText(id === "ghidra" ? "已是推荐版本" : "待完成系统安装", { exact: true }).waitFor();
      assert.equal(downloads, before + 1, "installing cached packages must not repeat the package download");
      if (id === "ghidra") { assert.equal(installs, 2); assert.match(savedConfig().engines.ghidra, /engines\/ghidra-/); }
      else { assert.equal(installers, 1); assert.equal(savedConfig().engines.hopper, undefined); assert.equal(savedConfig().managedEngines.hopper, undefined); }
    }
    await page.screenshot({ path: join(output, "cached-install.png"), fullPage: true });
    const cancelGhidra = ghidra.getByRole("button", { name: "取消任务", exact: true }), cancelHopper = hopper.getByRole("button", { name: "取消任务", exact: true });
    const original = savedConfig().downloads;
    // Synthetic future releases exercise updates without downloading real packages.
    versions.ghidra = "12.1.5"; versions.hopper = "6.6.1";
    for (const id of ["ghidra", "hopper"]) downloadGates.set(id, downloadGate());
    await (await prepareDownload("ghidra")).getByRole("button", { name: "确认下载", exact: true }).click();
    await cancelGhidra.waitFor(); await downloadGates.get("ghidra")!.entered;
    assert.equal(await ghidra.getByRole("button", { name: "检查Ghidra更新", exact: true }).isDisabled(), true);
    assert.equal(await hopper.getByRole("button", { name: "检查Hopper更新", exact: true }).isEnabled(), true, "regression: upper download must not grey out the lower card");
    assert.equal(await section.getByRole("button", { name: "检查JADX Headless更新", exact: true }).isEnabled(), true);
    const hopperConfirm = await prepareDownload("hopper");
    await java.getByRole("button", { name: "检查JDK 21更新", exact: true }).click();
    assert.equal(await hopperConfirm.getByRole("button", { name: "确认下载", exact: true }).isEnabled(), true, "other component checks preserve this confirmation");
    await hopperConfirm.getByRole("button", { name: "确认下载", exact: true }).click();
    await cancelHopper.waitFor(); await downloadGates.get("hopper")!.entered;
    assert.equal(await section.getByRole("button", { name: "取消任务", exact: true }).count(), 2);
    await page.screenshot({ path: join(output, "parallel-downloads.png"), fullPage: true });
    downloadGates.get("hopper")!.release(); await cancelHopper.waitFor({ state: "detached" });
    assert.equal(await cancelGhidra.isVisible(), true);
    assert.notEqual(savedConfig().downloads.hopper.directory, original.hopper.directory);
    const hopperDirectory = savedConfig().downloads.hopper.directory;
    downloadGates.get("ghidra")!.release(); await cancelGhidra.waitFor({ state: "detached" });
    assert.notEqual(savedConfig().downloads.ghidra.directory, original.ghidra.directory);
    assert.equal(savedConfig().downloads.hopper.directory, hopperDirectory);

    const completed = savedConfig().downloads, before = downloads;
    versions.ghidra = "12.1.6"; versions.hopper = "6.6.2";
    for (const id of ["ghidra", "hopper"]) downloadGates.set(id, downloadGate());
    for (const id of ["ghidra", "hopper"] as const) {
      await (await prepareDownload(id)).getByRole("button", { name: "确认下载", exact: true }).click();
      await downloadGates.get(id)!.entered;
    }
    await page.reload(); await cancelGhidra.waitFor(); await cancelHopper.waitFor();
    assert.equal(downloads, before + 2, "refresh restores jobs without repeating downloads");
    await cancelGhidra.click(); await cancelGhidra.waitFor({ state: "detached" });
    await ghidra.getByText("操作已取消。", { exact: true }).waitFor();
    assert.equal(await cancelHopper.isVisible(), true); assert.deepEqual(savedConfig().downloads.ghidra, completed.ghidra);
    assert.equal(await ghidra.getByRole("alert").count(), 0); assert.equal(await hopper.getByRole("alert").count(), 0);
    await page.screenshot({ path: join(output, "parallel-cancel.png"), fullPage: true });
    downloadGates.get("hopper")!.release(); await cancelHopper.waitFor({ state: "detached" });
    assert.notEqual(savedConfig().downloads.hopper.directory, completed.hopper.directory);
    assert.deepEqual(savedConfig().downloads.ghidra, completed.ghidra);
  }
  const beforeChecks = checks;
  await page.reload(); await java.getByText("已是推荐版本", { exact: true }).waitFor();
  assert.equal(checks, beforeChecks); assert.equal(installs, process.platform === "darwin" ? 2 : 1);
  if (process.platform === "darwin") await hopper.getByText("已下载 · 待安装", { exact: true }).waitFor();
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await section.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, `overflow ${width}`);
    for (const button of await section.getByRole("button").all()) {
      const box = await button.boundingBox(); assert.ok(box && box.height >= 44, `button target ${await button.innerText()} at ${width}`);
    }
    if ([390, 1440].includes(width)) await page.screenshot({ path: join(output, `engines-${width}.png`), fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log("REA engines UI passed: cached Ghidra installation without re-download, Hopper installer opening without marking installation complete, confirmations/reload, default locations, equivalent JDK version, parallel downloads and cancellation, 320/390/820/1440 layouts and 44px targets; fixture packages and installer only.");
} finally { for (const gate of downloadGates.values()) gate.release(); await browser.close(); await app.close(); rmSync(root, { recursive: true, force: true }); }
