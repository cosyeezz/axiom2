// Actual model page, isolated files and synthetic active-run refusal; no real provider requests.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";

const root = mkdtempSync(join(tmpdir(), "axiom-model-confirm-"));
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS || "test-results/model-confirmations");
mkdirSync(artifacts, { recursive: true });
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "shared-pi");
const modelsPath = join(process.env.AXIOM_PI_DIR, "models.json");
const app = await startServer({ root: join(root, "data"), port: 0 });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const errors: string[] = [], deleteRequests: { confirmStop?: boolean }[] = [];
page.on("pageerror", error => errors.push(error.message));
let requireActiveStop = false;
try {
  await page.routeWebSocket("**/ws", route => {
    const server = route.connectToServer();
    route.onMessage(message => {
      const command = JSON.parse(message.toString());
      if (requireActiveStop && command.op === "configuration.save" && !command.params.providers.some((provider: { providerId: string }) => provider.providerId === "confirmation-fixture")) {
        deleteRequests.push({ confirmStop: command.params.confirmStop });
        if (!command.params.confirmStop) {
          route.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: false, error: { code: "ACTIVE_RUNS_CONFIRMATION_REQUIRED", message: "隔离夹具：存在受影响任务，请明确确认停止。" } }));
          return;
        }
      }
      server.send(message);
    });
    server.onMessage(message => route.send(message));
  });
  await page.goto(app.origin + "/model-config.html");
  await page.locator("#add-supplier").click();
  await page.getByRole("menuitem", { name: "自定义接口", exact: true }).click();
  await page.locator("#provider-id").fill("confirmation-fixture");
  await page.locator("#provider-name").fill("确认框验收供应商");
  await page.locator("#provider-url").fill("http://127.0.0.1:1/v1");
  await page.locator("#provider-key").fill("TEST-ONLY-CONFIRMATION-KEY");
  await page.locator("#models-tab").click();
  await page.locator("#add-model").click();
  await page.locator("#new-model-id").fill("confirmation-model");
  await page.locator("#new-model-name").fill("确认框验收模型");
  await page.locator("#save-provider").click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  const baseline = readFileSync(modelsPath, "utf8");
  const rows = page.locator("#configured-model-table tbody tr");
  const deletion = page.getByRole("dialog", { name: "删除模型草稿？", exact: true });
  const trigger = page.getByRole("button", { name: "删除模型：确认框验收模型", exact: true });
  const safeFocus = async () => assert.equal(await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).evaluate(node => node === document.activeElement), true);
  const capture = async (name: string) => {
    const dialog = page.getByRole("dialog");
    await dialog.evaluate(async node => { node.getBoundingClientRect(); await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))); });
    const box = await dialog.boundingBox(), viewport = page.viewportSize()!;
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1);
    assert.equal(await dialog.evaluate(node => getComputedStyle(node).opacity), "1");
    await page.screenshot({ path: join(artifacts, name) });
  };
  for (const [theme, width, height] of [["dark", 1440, 900], ["light", 390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await trigger.locator("xpath=ancestor::tr").hover(); await trigger.click();
    await deletion.waitFor(); await safeFocus();
    assert.match(await deletion.locator(".confirm-subject").innerText(), /确认框验收模型\nconfirmation-model/);
    assert.match(await deletion.locator(".confirm-description").innerText(), /本页草稿.*保存后/);
    assert.match(await deletion.locator(".confirm-warning").innerText(), /退出整个供应商/);
    await capture(`saved-delete-${theme}-${width}.png`);
    await deletion.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(await trigger.evaluate(node => node === document.activeElement), true);
    assert.equal(await rows.count(), 1); assert.equal(readFileSync(modelsPath, "utf8"), baseline);
  }
  await trigger.click(); await deletion.getByRole("button", { name: "删除草稿", exact: true }).click();
  assert.equal(await rows.count(), 0);
  assert.equal(readFileSync(modelsPath, "utf8"), baseline, "confirmed deletion changes only this page until Save");
  await page.reload(); await page.locator("#models-tab").click(); await trigger.waitFor();
  await page.locator("#add-model").click();
  await page.locator("#new-model-id").fill("unpublished-draft"); await page.locator("#new-model-name").fill("未发布模型草稿");
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  const draft = page.getByRole("button", { name: "删除模型：未发布模型草稿", exact: true });
  await draft.locator("xpath=ancestor::tr").hover(); await draft.click(); await deletion.waitFor(); await safeFocus();
  assert.match(await deletion.locator(".confirm-description").innerText(), /尚未发布.*本页草稿/);
  assert.equal(await deletion.locator(".confirm-warning").count(), 0);
  await page.evaluate(() => document.documentElement.dataset.theme = "light");
  await capture("draft-delete-light-390.png");
  await deletion.getByRole("button", { name: "删除草稿", exact: true }).click();
  assert.equal(await rows.count(), 1); assert.equal(readFileSync(modelsPath, "utf8"), baseline);

  // Start the independent provider-removal scenario with the unchanged saved snapshot.
  await page.reload(); await page.locator("#provider-key").waitFor();
  await page.evaluate(() => document.documentElement.dataset.theme = "light");
  // Real asynchronous decision replacement: remove -> stop consent -> remove again.
  await page.locator("#suppliers-tab").click(); requireActiveStop = true;
  const remove = page.getByRole("button", { name: "删除供应商", exact: true });
  const providerDialog = page.getByRole("dialog", { name: "删除供应商？", exact: true });
  const stopDialog = page.getByRole("dialog", { name: "停止受影响的执行？", exact: true });
  await remove.click(); await providerDialog.getByRole("button", { name: "删除供应商", exact: true }).click();
  await stopDialog.waitFor(); await safeFocus();
  await stopDialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(readFileSync(modelsPath, "utf8"), baseline, "cancelling the next decision keeps provider and authentication");
  await remove.click(); await providerDialog.getByRole("button", { name: "删除供应商", exact: true }).click();
  await stopDialog.waitFor(); await safeFocus();
  await stopDialog.getByRole("button", { name: "停止并继续删除", exact: true }).click();
  await providerDialog.waitFor(); await safeFocus();
  await capture("provider-chained-confirm-light-390.png");
  await providerDialog.getByRole("button", { name: "删除供应商", exact: true }).click();
  await page.locator(".configuration-feedback").filter({ hasText: "已删除供应商" }).waitFor();
  assert.equal(JSON.parse(readFileSync(modelsPath, "utf8")).providers["confirmation-fixture"], undefined);
  assert.equal(JSON.parse(readFileSync(join(root, "shared-pi", "auth.json"), "utf8"))["confirmation-fixture"], undefined);
  assert.equal(deleteRequests.length, 3); assert.equal(deleteRequests.at(-1)?.confirmStop, true);
  assert.deepEqual(errors, []);
  writeFileSync(join(artifacts, "result.json"), JSON.stringify({ passed: true, cases: ["saved/unsaved model wording and warning", "dark/light real-page screenshots", "safe focus and restoration", "cancel and draft-only deletion preserve disk", "asynchronous chained provider confirmation and cancellation", "final removal carries explicit stop authorization"], errors }, null, 2));
  console.log("Model confirmations passed: actual-page saved/unsaved drafts, safe cancel/focus, disk preservation, dual-theme visuals and asynchronous chained provider removal.");
} catch (error) {
  await page.screenshot({ path: join(artifacts, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close(); await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
