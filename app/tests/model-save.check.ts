import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { ModelAccountService } from "../src/server/model-accounts.js";
import { accountDirectory } from "../src/server/model-account-storage.js";

const root = mkdtempSync(join(tmpdir(), "axiom-model-save-"));
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS || "test-results/model-save"); mkdirSync(artifacts, { recursive: true });
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "shared-pi");
const app = await startServer({ root: join(root, "data"), port: 0 });
const accounts = new ModelAccountService(app.agents.models);
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  let removeRequests = 0, firstSave = true, releaseFirstSave!: () => void, receiveFirstSave!: () => void;
  const firstSaveReceived = new Promise<void>(resolve => { receiveFirstSave = resolve; });
  let failure: "active" | "uncertain" | null = null, failList = false;
  await page.routeWebSocket("**/ws", route => {
    const server = route.connectToServer();
    route.onMessage(message => {
      const c = JSON.parse(message.toString());
      const reject = (code: string) => route.send(JSON.stringify({ type: "receipt", requestId: c.requestId, ok: false, error: { code, message: "隔离夹具：请确认受影响的执行或重新读取配置。" } }));
      if (c.op === "configuration.save" && firstSave) {
        firstSave = false; releaseFirstSave = () => server.send(message); receiveFirstSave(); return;
      }
      if (c.op === "accounts.list" && failList) { reject("FIXTURE_READ_FAILED"); return; }
      if (c.op === "accounts.remove") {
        removeRequests++;
        if (failure) { failList = failure === "uncertain"; reject(failure === "active" ? "ACTIVE_RUNS_CONFIRMATION_REQUIRED" : "UNCERTAIN"); return; }
      }
      server.send(message);
    });
    server.onMessage(message => route.send(message));
  });
  const card = (label: string) => page.getByRole("article", { name: `账号 ${label}`, exact: true });
  const addKey = async (label: string, key: string) => {
    await page.locator("#accounts-tab").click();
    await page.getByRole("button", { name: "添加账号", exact: true }).click();
    const setup = page.getByRole("dialog", { name: "添加账号", exact: true });
    await setup.getByLabel("账号名称", { exact: true }).fill(label);
    await setup.getByRole("button", { name: "API Key 登录", exact: true }).click();
    await page.locator("#auth-answer").fill(key);
    await page.getByRole("button", { name: "提交认证输入", exact: true }).click();
    await card(label).waitFor();
    return (await accounts.list()).accounts.find(row => row.label === label)!;
  };
  const stored = (id: string) => JSON.parse(readFileSync(join(accountDirectory(app.agents.models.dir, id), "auth.json"), "utf8"))["save-feedback-test"].key;
  const saved = () => page.locator(".configuration-feedback[data-saved=true]").waitFor();
  await page.goto(app.origin + "/model-config.html");
  await page.locator("#add-supplier").click();
  await page.getByRole("menuitem", { name: "自定义接口", exact: true }).click();
  await page.locator("#provider-id").fill("save-feedback-test");
  await page.locator("#provider-name").fill("认证分离测试");
  await page.locator("#provider-url").fill("http://127.0.0.1:1/v1");
  assert.equal(await page.locator("#provider-key").count(), 0);
  await page.locator("#save-provider").click(); await firstSaveReceived;
  try {
    const progress = page.getByRole("status").and(page.locator(".configuration-progress"));
    await progress.filter({ hasText: "正在保存连接和模型配置…" }).waitFor();
    assert.ok(await progress.evaluate(node => node.closest("[inert]") === null));
    assert.ok(await page.locator(".container").evaluate(node => node instanceof HTMLElement && node.inert));
  } finally { releaseFirstSave(); }
  await saved();
  assert.match(await page.locator(".configuration-feedback").innerText(), /账号认证保持不变/);
  assert.equal(await page.locator(".configuration-actions button").count(), 3);
  assert.equal(await page.locator(".topnav button:not(.maintenance-launcher)").count(), 0);
  const first = await addKey("首次账号", "TEST-ONLY-FIRST-KEY");
  assert.equal(stored(first.id), "TEST-ONLY-FIRST-KEY");
  assert.ok(first.active);
  await page.setViewportSize({ width: 1440, height: 1400 });
  for (const tab of ["suppliers", "models"]) {
    await page.locator(`#${tab}-tab`).click();
    const content = await page.locator(`#${tab}-screen`).boundingBox(), actions = await page.locator(".configuration-actions").boundingBox();
    assert.ok(content && actions && actions.y >= content.y + content.height - 1 && actions.y - content.y - content.height < 90);
    assert.ok(actions.y + actions.height < 1200, "actions follow content rather than the bottom of tall windows");
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await page.reload();
  await card("首次账号").waitFor(); await page.locator("#suppliers-tab").click();
  await page.locator("#provider-url").fill("http://127.0.0.1:2/v1");
  await page.locator("#provider-url").fill("http://127.0.0.1:1/v1");
  assert.ok(await page.locator("#save-provider").isDisabled());
  const second = await addKey("追加账号", "TEST-ONLY-SECOND-KEY");
  assert.equal(stored(first.id), "TEST-ONLY-FIRST-KEY"); assert.equal(stored(second.id), "TEST-ONLY-SECOND-KEY");
  assert.ok(!second.active, "interactive login never replaces the existing default");
  await page.locator("#suppliers-tab").click(); await page.locator("#provider-name").fill("保留账号认证");
  await page.locator("#accounts-tab").click();
  assert.ok(await card("首次账号").getByRole("button", { name: "删除", exact: true }).isDisabled());
  assert.ok(await page.getByRole("button", { name: "添加账号", exact: true }).isDisabled());
  await page.locator("#save-provider").click(); await saved();
  assert.equal(stored(first.id), "TEST-ONLY-FIRST-KEY");
  await page.locator("#suppliers-tab").click(); await page.locator("#provider-url").fill("invalid-url");
  await page.locator("#save-provider").click();
  const error = page.locator(".configuration-feedback[data-error=true]");
  await error.filter({ hasText: "接口地址无效" }).waitFor();
  assert.equal(await error.getAttribute("role"), "alert");
  assert.match(await error.innerText(), /保留账号认证.*save-feedback-test.*接口地址/);
  assert.doesNotMatch(await error.innerText(), /TEST-ONLY|invalid-url/);
  assert.equal(await error.evaluate(el => getComputedStyle(el).color), "rgb(252, 165, 165)");
  assert.equal(await error.evaluate(el => getComputedStyle(el).fontWeight), "600");
  assert.equal(await page.locator("#provider-url").inputValue(), "invalid-url");
  assert.equal(stored(first.id), "TEST-ONLY-FIRST-KEY");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const banner = await error.boundingBox(); assert.ok(banner && banner.y >= 0 && banner.y + banner.height < 844);
  await page.locator("#provider-url").fill("http://127.0.0.1:2/v1");
  await page.locator("#save-provider").click(); await saved();
  await page.locator("#models-tab").click(); await page.locator("#add-model").click();
  await page.locator("#new-model-id").fill("preserved-model");
  await page.locator("#save-provider").click(); await saved();
  const configPath = join(root, "shared-pi", "models.json"), configBefore = readFileSync(configPath, "utf8");
  await page.locator("#accounts-tab").click();
  // Delete the nondefault slot: duplicate confirmation clicks still submit only once.
  failure = "active";
  await card("追加账号").getByRole("button", { name: "删除", exact: true }).click();
  const removal = page.getByRole("dialog", { name: "删除账号", exact: true });
  await removal.getByRole("button", { name: "确认删除", exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await removal.getByRole("button", { name: "停止执行并删除", exact: true }).waitFor();
  assert.equal(removeRequests, 1);
  await removal.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(stored(second.id), "TEST-ONLY-SECOND-KEY");
  await card("追加账号").getByRole("button", { name: "删除", exact: true }).click();
  await removal.getByRole("button", { name: "确认删除", exact: true }).click();
  await removal.getByRole("button", { name: "停止执行并删除", exact: true }).waitFor();
  failure = null; await removal.getByRole("button", { name: "停止执行并删除", exact: true }).click();
  await removal.waitFor({ state: "hidden" }); await card("追加账号").waitFor({ state: "detached" });
  assert.equal(readFileSync(configPath, "utf8"), configBefore);
  failure = "uncertain";
  await card("首次账号").getByRole("button", { name: "删除", exact: true }).click();
  await removal.getByRole("button", { name: "确认删除", exact: true }).click(); await removal.waitFor({ state: "hidden" });
  assert.ok(await card("首次账号").getByRole("button", { name: "删除", exact: true }).isDisabled(), "uncertain mutation plus failed reread forbids replay");
  assert.equal(stored(first.id), "TEST-ONLY-FIRST-KEY");
  failure = null; failList = false;
  await page.getByRole("button", { name: "刷新账号列表", exact: true }).click();
  await card("首次账号").getByRole("button", { name: "删除", exact: true }).click();
  await removal.getByRole("button", { name: "确认删除", exact: true }).click();
  await page.getByText("此连接尚无已保存账号。添加首个账号后会自动设为默认。", { exact: true }).waitFor();
  assert.equal(readFileSync(configPath, "utf8"), configBefore);
  assert.equal((await accounts.list()).accounts.length, 0);
  await page.reload(); await page.getByRole("button", { name: "添加账号", exact: true }).waitFor();
  assert.equal(await page.locator(".model-account-card").count(), 0);
  assert.deepEqual(errors, []);
  console.log("PASS save feedback/inert/clean draft/errors/mobile, append-only secret isolation, dirty mutation block, duplicate clicks, stop/cancel, uncertain mutation reread, last deletion preserves models and connection.");
} catch (error) {
  for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) await page.screenshot({ path: join(artifacts, `failure-${index}.png`), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser.close(); await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
