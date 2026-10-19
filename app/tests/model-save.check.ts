import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";

const root = mkdtempSync(join(tmpdir(), "axiom-model-save-"));
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "shared-pi");
const app = await startServer({ root: join(root, "data"), port: 0 });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let logoutRequests = 0;
  let firstSave = true, releaseFirstSave!: () => void, receiveFirstSave!: () => void;
  const firstSaveReceived = new Promise<void>(resolve => { receiveFirstSave = resolve; });
  let logoutFailure: "active" | "uncertain" | null = null;
  await page.routeWebSocket("**/ws", (route) => {
    const server = route.connectToServer();
    route.onMessage((message) => {
      const c = JSON.parse(message.toString());
      if (c.op === "configuration.save" && firstSave) {
        firstSave = false;
        releaseFirstSave = () => server.send(message);
        receiveFirstSave();
        return;
      }
      if (c.op === "configuration.save" && c.params.providers.some((provider: { clearKey?: boolean }) => provider.clearKey)) {
        logoutRequests++;
        if (logoutFailure) {
          const code = logoutFailure === "active" ? "ACTIVE_RUNS_CONFIRMATION_REQUIRED" : "UNCERTAIN";
          route.send(JSON.stringify({ type: "receipt", requestId: c.requestId, ok: false, error: { code, message: "隔离夹具：请确认受影响的执行或重新读取配置。" } }));
          return;
        }
        if (logoutRequests > 1) assert.equal(c.params.confirmStop, true);
      }
      server.send(message);
    });
    server.onMessage((message) => route.send(message));
  });
  await page.goto(app.origin + "/model-config.html");
  await page.locator("#add-supplier").click();
  await page.getByRole("menuitem", { name: "自定义接口", exact: true }).click();
  await page.locator("#provider-id").fill("save-feedback-test");
  await page.locator("#provider-name").fill("密钥保存测试");
  await page.locator("#provider-url").fill("http://127.0.0.1:1/v1");
  await page.locator("#provider-key").fill("TEST-ONLY-FIRST-KEY");
  assert.match(await page.locator("#provider-key-status").innerText(), /尚未保存/);
  await page.locator("#save-provider").click();
  await firstSaveReceived;
  try {
    const progress = page.getByRole("status").and(page.locator(".configuration-progress"));
    await progress.filter({ hasText: "正在保存配置和密钥…" }).waitFor();
    assert.equal(await progress.evaluate(node => node.closest("[inert]") === null), true, "progress stays outside the inert subtree");
    assert.equal(await page.locator(".container").evaluate(node => node instanceof HTMLElement && node.inert), true, "saving still blocks editing");
  } finally { releaseFirstSave(); }
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  assert.match(await page.locator(".configuration-feedback").innerText(), /API 密钥已写入本地文件/);
  assert.equal(await page.locator("#save-provider").innerText(), "保存");
  assert.equal(await page.locator("#reset-provider").innerText(), "取消");
  assert.equal(await page.locator(".configuration-actions button").count(), 3);
  assert.equal(await page.locator(".topnav button").count(), 0);
  assert.equal(await page.locator("#provider-key").inputValue(), "");
  assert.match(await page.locator("#provider-key").getAttribute("placeholder") || "", /已保存/);
  assert.match(await page.locator("#provider-key-status").innerText(), /已保存到本地/);
  await page.locator(".credential-details summary").click();
  assert.ok(await page.getByText(join(root, "shared-pi", "auth.json"), { exact: true }).isVisible());
  const keyOnDisk = () => JSON.parse(readFileSync(join(root, "shared-pi", "auth.json"), "utf8"))["save-feedback-test"]?.key;
  assert.ok(keyOnDisk() === "TEST-ONLY-FIRST-KEY", "initial key must reach disk");
  const banner = await page.locator(".configuration-feedback").boundingBox();
  assert.ok(banner && banner.y >= 0 && banner.y + banner.height < 900);

  // Tall windows must not stretch the form and push its actions to the viewport bottom.
  await page.setViewportSize({ width: 1440, height: 1400 });
  for (const tab of ["suppliers", "models"]) {
    await page.locator(`#${tab}-tab`).click();
    const content = await page.locator(`#${tab}-screen`).boundingBox();
    const actions = await page.locator(".configuration-actions").boundingBox();
    assert.ok(content && actions);
    assert.ok(actions.y >= content.y + content.height - 1 && actions.y - content.y - content.height < 90, `${tab}: actions follow content`);
    assert.ok(actions.y + actions.height < 1200, `${tab}: actions are not pinned to the bottom`);
  }
  await page.locator("#suppliers-tab").click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page.locator("#provider-key-status").filter({ hasText: "已保存到本地" }).waitFor();
  await page.locator("#provider-key").fill("TEST-ONLY-REPLACEMENT");
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  assert.ok(keyOnDisk() === "TEST-ONLY-REPLACEMENT", "replacement must reach disk");
  await page.locator("#provider-name").fill("保留旧密钥");
  assert.ok(await page.locator("#logout-provider").isDisabled(), "logout must not publish an unrelated draft");
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  assert.ok(keyOnDisk() === "TEST-ONLY-REPLACEMENT", "empty key must preserve stored credential");

  await page.locator("#provider-url").fill("invalid-url");
  await page.locator("#provider-key").fill("TEST-ONLY-UNSAVED");
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-error=true]").filter({ hasText: "接口地址无效" }).waitFor();
  const failure = page.locator(".configuration-feedback");
  assert.equal(await failure.getAttribute("role"), "alert");
  assert.match(await failure.innerText(), /保留旧密钥.*save-feedback-test.*接口地址/);
  assert.doesNotMatch(await failure.innerText(), /TEST-ONLY-UNSAVED|invalid-url/);
  assert.equal(await failure.evaluate((el) => getComputedStyle(el).color), "rgb(252, 165, 165)");
  assert.equal(await failure.evaluate((el) => getComputedStyle(el).fontWeight), "600");
  assert.equal(await page.locator("#provider-key").inputValue(), "TEST-ONLY-UNSAVED");
  assert.ok(keyOnDisk() === "TEST-ONLY-REPLACEMENT", "failed save must preserve disk credential");
  assert.equal(await page.locator(".configuration-feedback").getAttribute("data-saved"), "false");

  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  const mobileBanner = await failure.boundingBox();
  assert.ok(mobileBanner && mobileBanner.y >= 0 && mobileBanner.y + mobileBanner.height < 844);
  await page.locator("#provider-url").fill("http://127.0.0.1:1/v1");
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true][data-error=false]").waitFor();
  assert.equal(await failure.getAttribute("role"), "status");
  assert.ok(keyOnDisk() === "TEST-ONLY-UNSAVED", "corrected draft must save successfully");
  // Keep a real model definition through supplier-level logout.
  await page.locator("#models-tab").click();
  await page.locator("#add-model").click();
  await page.locator("#new-model-id").fill("logout-preserved-model");
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  await page.locator("#suppliers-tab").click();
  const modelsOnDisk = () => JSON.parse(readFileSync(join(root, "shared-pi", "models.json"), "utf8")).providers["save-feedback-test"];
  const preservedModels = modelsOnDisk().models;
  assert.equal(preservedModels[0].id, "logout-preserved-model");
  logoutFailure = "active";
  await page.locator("#logout-provider").click();
  const stopDialog = page.getByRole("dialog", { name: "停止受影响的执行并退出认证？" });
  await stopDialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(keyOnDisk(), "TEST-ONLY-UNSAVED", "cancelling must keep authentication");
  const beforeDoubleClick = logoutRequests;
  await page.locator("#logout-provider").evaluate((button) => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await stopDialog.waitFor();
  assert.equal(logoutRequests, beforeDoubleClick + 1, "duplicate clicks must not submit twice");
  logoutFailure = null;
  await stopDialog.getByRole("button", { name: "确认", exact: true }).click();
  await page.locator(".configuration-feedback").filter({ hasText: "已退出认证" }).waitFor();
  assert.equal(keyOnDisk(), undefined);
  assert.deepEqual(modelsOnDisk().models, preservedModels);
  assert.equal(modelsOnDisk().name, "保留旧密钥");
  assert.ok(await page.locator("#logout-provider").isDisabled());
  assert.equal(await page.locator("#provider-key").inputValue(), "");
  await page.reload();
  await page.locator("#provider-key").waitFor();
  assert.ok(await page.locator("#logout-provider").isDisabled(), "logout persists after reload");
  await page.locator("#provider-key").fill("TEST-ONLY-NEW-AUTH");
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  logoutFailure = "uncertain";
  await page.locator("#logout-provider").click();
  await page.locator(".configuration-feedback[data-error=true]").filter({ hasText: "退出认证失败" }).waitFor();
  assert.ok(await page.locator("#logout-provider").isDisabled(), "uncertain logout requires reconciliation");
  assert.equal(keyOnDisk(), "TEST-ONLY-NEW-AUTH");
  await page.getByRole("button", { name: "重新读取配置", exact: true }).click();
  await page.locator(".configuration-feedback[data-error=false]").waitFor();
  assert.ok(await page.locator("#logout-provider").isEnabled());
  assert.deepEqual(errors, []);
  console.log("Model save UI: disk persistence, replacement, reload, blank retention, feedback, failure preservation, mobile layout, controls following content, immediate logout/model preservation/active-run confirmation/duplicate clicks/reconciliation passed.");
} finally {
  await browser.close();
  await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR;
  else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
