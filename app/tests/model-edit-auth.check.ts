import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { levelsOf } from "../src/server/models/draft.js";

const root = mkdtempSync(join(tmpdir(), "axiom-model-edit-auth-"));
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
const app = await startServer({ root: join(root, "data"), port: 0 });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const service = app.agents.models;
  const runtime = await service.runtime();
  const native = runtime.getModels("github-copilot")[0];
  const authPath = join(service.dir, "auth.json");
  // No external OAuth or token refresh. Configuration, deletion and logout use the real server.
  writeFileSync(authPath, JSON.stringify({ "github-copilot": { type: "oauth", access: "TEST-ACCESS", refresh: "TEST-REFRESH", expires: Date.now() + 3_600_000 } }));
  service.checkAuth = async (current, providerId) => (await current.listCredentials()).some(item => item.providerId === providerId)
    ? { type: "oauth", source: "stored" } : undefined;
  const draft = await service.read();
  draft.providers = [{ id: "github-copilot", originalId: draft.providers.find(provider => provider.providerId === "github-copilot")?.originalId, providerId: "github-copilot", name: "OAuth fixture", connectionType: "oauth", api: "", url: "", key: "", headers: [], body: [], models: [
    { key: native.id, id: native.id, name: "编辑测试模型", levels: levelsOf(native), headers: [], body: [] },
  ] }];
  await service.save(draft);
  const credentials = readFileSync(authPath, "utf8");
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let saves = 0;
  await page.routeWebSocket("**/ws", route => {
    const server = route.connectToServer();
    route.onMessage(message => { if (JSON.parse(message.toString()).op === "configuration.save") saves++; server.send(message); });
    server.onMessage(message => route.send(message));
  });
  await page.goto(app.origin + "/model-config.html");
  await page.locator("#provider-auth-status").filter({ hasText: "已通过 OAuth 登录" }).waitFor();
  assert.ok(await page.getByRole("button", { name: "退出授权", exact: true }).isEnabled());
  await page.locator("#models-tab").click();
  const editor = page.locator("#model-editor");
  const edit = page.getByRole("button", { name: "编辑模型：编辑测试模型", exact: true });
  const finish = editor.getByRole("button", { name: "完成编辑", exact: true });
  const cancel = editor.getByRole("button", { name: "取消", exact: true });
  const save = page.locator("#save-provider");
  const noDialog = async () => assert.equal(await page.getByRole("dialog").count(), 0);
  const openEdit = async () => {
    await edit.locator("xpath=ancestor::tr").hover();
    await edit.click();
  };

  await openEdit();
  assert.ok(await finish.isDisabled());
  assert.ok(await save.isDisabled());
  await cancel.click();
  await editor.waitFor({ state: "detached" });
  await noDialog();

  // Reverting a field is not a change; neither inline nor global Cancel should warn.
  await openEdit();
  await page.locator("#new-model-name").fill("临时名称");
  assert.ok(await finish.isEnabled());
  assert.ok(await save.isEnabled());
  await page.locator("#new-model-name").fill("编辑测试模型");
  assert.ok(await finish.isDisabled());
  assert.ok(await save.isDisabled());
  await page.locator("#reset-provider").click();
  await editor.waitFor({ state: "detached" });
  await noDialog();

  await openEdit();
  await page.getByRole("button", { name: "重新读取配置", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  await noDialog();
  assert.equal(saves, 0, "unchanged edits never publish");

  await openEdit();
  await page.locator("#new-model-name").fill("实际修改");
  await cancel.click();
  const discard = page.getByRole("dialog", { name: "放弃当前模型编辑？", exact: true });
  await discard.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.locator("#new-model-name").inputValue(), "实际修改");
  await cancel.click();
  await discard.getByRole("button", { name: "确认", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  assert.ok(await save.isDisabled());

  // Staging and then restoring a model must also restore the page's clean state.
  await openEdit();
  await page.locator("#new-model-name").fill("实际修改");
  await finish.click();
  assert.ok(await save.isEnabled());
  const changedEdit = page.getByRole("button", { name: "编辑模型：实际修改", exact: true });
  await changedEdit.locator("xpath=ancestor::tr").hover();
  await changedEdit.click();
  await page.locator("#new-model-name").fill("编辑测试模型");
  await finish.click();
  assert.ok(await save.isDisabled());
  await page.locator("#suppliers-tab").click();
  await page.locator("#provider-name").fill("Changed");
  assert.ok(await save.isEnabled());
  await page.locator("#provider-name").fill("OAuth fixture");
  assert.ok(await save.isDisabled());
  assert.ok(await page.locator("#logout-provider").isEnabled());

  await page.locator("#models-tab").click();
  await page.locator("#add-model").click();
  assert.ok(await finish.isDisabled());
  await page.locator("#model-cost-input").fill("3");
  assert.ok(await finish.isEnabled());
  await page.locator("#model-cost-input").fill("");
  assert.ok(await finish.isDisabled());
  assert.ok(await save.isDisabled());
  await cancel.click();
  await noDialog();
  const remove = page.getByRole("button", { name: "删除模型：编辑测试模型", exact: true });
  await remove.locator("xpath=ancestor::tr").hover();
  await remove.click();
  const deletion = page.getByRole("dialog", { name: "删除模型草稿？", exact: true });
  assert.match(await deletion.innerText(), /授权和其他模型保持不变/);
  await deletion.getByRole("button", { name: "确认", exact: true }).click();
  await save.click();
  await page.locator(".configuration-feedback[data-saved=true]").waitFor();
  await noDialog();
  assert.equal(readFileSync(authPath, "utf8"), credentials);
  assert.deepEqual((await service.read()).providers[0].models, []);
  await page.reload();
  await page.locator("#provider-auth-status").filter({ hasText: "已通过 OAuth 登录" }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.getByRole("button", { name: "退出授权", exact: true }).click();
  await page.locator(".configuration-feedback").filter({ hasText: "已退出授权" }).waitFor();
  assert.equal(JSON.parse(readFileSync(authPath, "utf8"))["github-copilot"], undefined);
  assert.equal((await service.read()).providers.length, 1);
  assert.ok(await page.locator("#logout-provider").isDisabled());
  assert.ok(await page.locator("#oauth-login-provider").isEnabled());
  assert.deepEqual(errors, []);
  console.log("PASS: unchanged/reverted edit cancellation, real-change protection, clean-state buttons, last OAuth model deletion/auth retention, independent logout, mobile layout.");
} finally {
  await browser.close();
  await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR;
  else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
