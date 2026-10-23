import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir, networkInterfaces } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { chromium, type Page } from "playwright";
import { startServer } from "../src/server/index.js";
import { RemoteAccess } from "../src/server/remote-access.js";
import { OpenDialogError } from "../src/server/open-dialog.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "axiom-path-ui-"))), pi = join(root, "shared");
const source = join(root, "技能 source"), updated = join(root, "新版目录"), external = join(pi, "skills", "external");
for (const path of [source, updated, external]) mkdirSync(path, { recursive: true });
const guide = (name: string) => `---\nname: ${name}\ndescription: path picker fixture\n---\n# ${name}\n`;
writeFileSync(join(source, "SKILL.md"), guide("source-skill"));
writeFileSync(join(updated, "SKILL.md"), guide("external"));
writeFileSync(join(external, "SKILL.md"), guide("external"));
writeFileSync(join(source, "配置.json"), "{}");
const file = join(root, "single.md"); writeFileSync(file, guide("single"));
const old = process.env.AXIOM_PI_DIR, oldPi = process.env.PI_CODING_AGENT_DIR;
process.env.AXIOM_PI_DIR = pi; process.env.PI_CODING_AGENT_DIR = pi;
let selected: string[] = [], failure = false, waitForAbort = false, aborted: (() => void) | undefined;
const kinds: string[] = [];
const app = await startServer({ root: join(root, "data"), port: 0,
  pickResources: async (_options, signal) => {
    if (waitForAbort) return new Promise((_resolve, reject) => signal.addEventListener("abort", () => { aborted?.(); reject(signal.reason); }, { once: true }));
    if (failure) throw new OpenDialogError("测试选择器失败", 503);
    return selected;
  },
  pickPaths: async options => { kinds.push(options.kind); return selected; },
});
const remoteHost = Object.values(networkInterfaces()).flat().find(address => address?.family === "IPv4" && !address.internal)?.address;
assert.ok(remoteHost, "remote UI check needs a non-loopback IPv4 interface");
const reserve = createServer(); reserve.listen(0, remoteHost); await once(reserve, "listening");
const port = (reserve.address() as { port: number }).port; await new Promise<void>(resolve => reserve.close(() => resolve()));
const gateway = new RemoteAccess(app.origin, () => [remoteHost], port); await gateway.initialize();
const remote = `http://${remoteHost}:${port}`;
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const artifacts = process.env.AXIOM_PATH_ARTIFACTS ?? "/tmp/axiom-path-ui-review"; mkdirSync(artifacts, { recursive: true });
const errors: string[] = [];
async function createMcp(page: Page, origin: string, config: string) {
  await page.goto(origin + "/resources.html");
  await page.getByRole("tab", { name: /^MCP/ }).click();
  await page.getByRole("complementary", { name: "MCP 列表", exact: true }).getByRole("button", { name: "添加 MCP", exact: true }).click();
  await page.getByLabel("MCP 连接配置（JSON）", { exact: true }).fill(config);
}
async function caret(page: Page, token: string) {
  await page.locator("#resource-config").evaluate((node, token) => {
    const input = node as HTMLTextAreaElement; input.focus(); const start = input.value.indexOf(token) + 1; input.setSelectionRange(start, start);
  }, token);
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); page.on("pageerror", e => errors.push(e.message));
  await page.goto(app.origin + "/resources.html");
  await page.locator("#resource-content").waitFor();
  await page.getByText("更新安装来源", { exact: true }).click();
  selected = [updated];
  await page.locator(".resources-maintenance").getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.waitForFunction(path => document.querySelector<HTMLInputElement>("#resource-update-source")?.value === path, updated);
  assert.equal(kinds.at(-1), "folder", "external skill update must select a folder");
  await page.getByRole("button", { name: "安装技能", exact: true }).first().click();
  const sourceInput = page.getByLabel("资源来源", { exact: true });
  await sourceInput.fill("npm:retained-draft"); selected = [];
  await page.getByRole("button", { name: "打开文件或文件夹", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.path-input button[aria-haspopup="dialog"]')?.hasAttribute("disabled"));
  assert.equal(await sourceInput.inputValue(), "npm:retained-draft", "cancel keeps draft");
  failure = true;
  await page.getByRole("button", { name: "打开文件或文件夹", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "测试选择器失败" }).waitFor();
  assert.equal(await sourceInput.inputValue(), "npm:retained-draft"); failure = false;
  selected = [file];
  await page.getByRole("button", { name: "打开文件或文件夹", exact: true }).click();
  await page.waitForFunction(path => document.querySelector<HTMLInputElement>("#resource-source")?.value === path, file);
  assert.equal(await page.getByLabel("技能名称", { exact: true }).inputValue(), "single");
  await page.getByLabel("技能名称", { exact: true }).fill("my-custom-skill");
  selected = [source];
  await page.getByRole("button", { name: "打开文件或文件夹", exact: true }).click();
  await page.waitForFunction(path => document.querySelector<HTMLInputElement>("#resource-source")?.value === path, source);
  assert.equal(await page.getByLabel("技能名称", { exact: true }).inputValue(), "my-custom-skill", "picking a new source retains a custom skill name");
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(artifacts, `skill-source-${width}.png`), fullPage: true });
  }
  const abortObserved = new Promise<void>(resolve => { aborted = resolve; }); waitForAbort = true;
  await page.getByRole("button", { name: "打开文件或文件夹", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.path-input button[aria-haspopup="dialog"]')?.getAttribute("aria-busy") === "true");
  await page.goto(app.origin + "/settings.html"); await abortObserved; waitForAbort = false;

  const draft = JSON.stringify({ command: "npx", cwd: ".", args: ["[已保存，保持此值以保留]"], env: { KEEP: "unchanged" } }, null, 2);
  await createMcp(page, app.origin, draft);
  await caret(page, '"npx"'); selected = [file];
  await page.getByRole("button", { name: "选择文件", exact: true }).click();
  await page.waitForFunction(path => JSON.parse(document.querySelector<HTMLTextAreaElement>("#resource-config")!.value).command === path, file);
  assert.equal(kinds.at(-1), "file");
  await caret(page, '"."'); selected = [source];
  await page.getByRole("button", { name: "选择目录", exact: true }).click();
  await page.waitForFunction(path => JSON.parse(document.querySelector<HTMLTextAreaElement>("#resource-config")!.value).cwd === path, source);
  assert.equal(kinds.at(-1), "folder");
  const windowsPath = 'C:\\资料 空格\\tools\\config.json';
  await page.route("**/api/files/pick?kind=file", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [{ path: windowsPath, name: "config.json", kind: "file" }] }) }));
  await caret(page, '"[已保存，保持此值以保留]"');
  await page.getByRole("button", { name: "选择文件", exact: true }).click();
  await page.waitForFunction(path => JSON.parse(document.querySelector<HTMLTextAreaElement>("#resource-config")!.value).args[0] === path, windowsPath);
  const parsed = JSON.parse(await page.locator("#resource-config").inputValue());
  assert.equal(parsed.env.KEEP, "unchanged"); assert.equal(parsed.command, file); assert.equal(parsed.cwd, source);
  await caret(page, '"command"');
  await page.getByRole("button", { name: "选择文件", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "请先将光标" }).waitFor();
  assert.deepEqual(JSON.parse(await page.locator("#resource-config").inputValue()), parsed);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(artifacts, `mcp-path-${width}.png`), fullPage: true });
  }

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } }); phone.on("pageerror", e => errors.push(e.message));
  await createMcp(phone, remote, draft); await caret(phone, '"npx"');
  await phone.getByRole("button", { name: "选择文件", exact: true }).click();
  const dialog = phone.getByRole("dialog", { name: "选择电脑文件" }); await dialog.waitFor();
  await dialog.getByLabel("目录路径").fill(source); await dialog.getByRole("button", { name: "前往", exact: true }).click();
  await dialog.getByRole("checkbox", { name: "选择 配置.json", exact: true }).check();
  await phone.screenshot({ path: join(artifacts, "remote-file.png"), fullPage: true });
  await dialog.getByRole("button", { name: "确认选择", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await phone.waitForFunction(path => JSON.parse(document.querySelector<HTMLTextAreaElement>("#resource-config")!.value).command === path, join(source, "配置.json"));
  await caret(phone, '"."');
  await phone.getByRole("button", { name: "选择目录", exact: true }).click();
  await dialog.getByLabel("目录路径").fill(source); await dialog.getByRole("button", { name: "前往", exact: true }).click();
  await phone.waitForFunction(path => document.querySelector<HTMLInputElement>("#remote-path")?.value === path && !document.querySelector<HTMLButtonElement>(".remote-file-dialog footer button")?.disabled, source);
  assert.equal(await dialog.getByRole("checkbox").count(), 0, "folder mode has navigation only");
  assert.equal(await dialog.getByRole("button", { name: "配置.json", exact: true }).count(), 0);
  await dialog.getByRole("button", { name: "选择此文件夹", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  await phone.waitForFunction(path => JSON.parse(document.querySelector<HTMLTextAreaElement>("#resource-config")!.value).cwd === path, source);
  const retained = await phone.locator("#resource-config").inputValue();
  await caret(phone, JSON.stringify(source)); await phone.getByRole("button", { name: "选择目录", exact: true }).click();
  await dialog.getByLabel("目录路径").fill(join(root, "missing")); await dialog.getByRole("button", { name: "前往", exact: true }).click();
  await dialog.getByRole("status").filter({ hasText: /ENOENT|目录无法读取/ }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "选择此文件夹", exact: true }).isDisabled(), true, "failed navigation cannot select a stale directory");
  await dialog.getByRole("button", { name: "关闭选择", exact: true }).click();
  assert.equal(await phone.locator("#resource-config").inputValue(), retained);
  assert.deepEqual(errors, []);
  console.log(`path picker UI: skill update/import, cancel/error/retry/unmount abort, MCP file/cwd/masked args/Windows escaping, remote modes and responsive layouts passed; artifacts: ${artifacts}`);
} catch (error) {
  for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) {
    await page.screenshot({ path: join(artifacts, `failure-${index}.png`), fullPage: true });
    writeFileSync(join(artifacts, `failure-${index}.txt`), await page.locator("body").innerText());
  }
  throw error;
} finally {
  await browser.close(); await gateway.close(); await app.close();
  if (old === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = old;
  if (oldPi === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldPi;
  rmSync(root, { recursive: true, force: true });
}
