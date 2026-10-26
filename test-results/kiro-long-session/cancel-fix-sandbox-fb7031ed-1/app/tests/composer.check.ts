// Standalone: npm exec tsx tests/composer.check.ts
// Uses current source (Vite dev), isolated pi/data/workspaces, and real files.* commands.
// No model requests are allowed: prompts are intercepted; only the explicit final send is expected.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type FileChooser, type Page } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Command, Draft, Scope } from "../src/shared/protocol.js";
import { checkImageComposer } from "./image-composer.check.js";

const root = mkdtempSync(join(tmpdir(), "axiom-composer-"));
const artifacts = resolve("test-results/composer");
const project = join(root, "workspace A"), other = join(root, "workspace B");
const folder = join(root, "upload folder"), pi = join(root, "pi");
for (const dir of [artifacts, project, other, pi, join(project, "nested"), join(folder, "deep")])
  mkdirSync(dir, { recursive: true });
writeFileSync(join(project, "composer-alpha.ts"), "export const alpha = 1;\n");
writeFileSync(join(project, "composer-beta.md"), "# beta\n");
writeFileSync(join(project, "nested", "space name.rs"), "fn main() {}\n");
writeFileSync(join(other, "composer-foreign.txt"), "Other workspace only\n");
writeFileSync(join(folder, "root.txt"), "folder root\n");
writeFileSync(join(folder, "deep", "中文.any"), "nested UTF-8 text\n");
writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: {
  "composer-fixture": { api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1",
    models: [{ id: "fixture", name: "Composer Fixture", input: ["text", "image"] }] },
} }));
writeFileSync(join(pi, "auth.json"), JSON.stringify({ "composer-fixture": { type: "api_key", key: "isolated-test-only" } }));
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = pi;
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined, page: Page | undefined;
const errors: string[] = [], commands: Command[] = [], sends: Command[] = [], passed: string[] = [];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1kAAAAASUVORK5CYII=", "base64");

async function eventually(check: () => Promise<boolean>, message: string) {
  const deadline = Date.now() + 12_000;
  do {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 40));
  } while (Date.now() < deadline);
  assert.fail(message);
}
async function currentScope(): Promise<Scope> {
  return page!.evaluate(() => JSON.parse(sessionStorage.getItem("view")!));
}
async function draft(scope: Scope): Promise<Draft> {
  return page!.evaluate(async (s) => {
    const modulePath = "/src/client/drafts.ts";
    return (await import(/* @vite-ignore */ modulePath)).getDraft(s);
  }, scope);
}
async function openWorkspace(path: string) {
  const previous = await currentScope();
  await page!.locator("#workspace-picker > summary").click();
  await page!.locator("#add-workspace").click();
  await page!.locator("#workspace-path").fill(path);
  await page!.getByRole("checkbox").check();
  await page!.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page!.waitForFunction((id) => {
    const view = JSON.parse(sessionStorage.getItem("view") || "{}");
    return view.workspaceId !== id && !!view.sessionId && !(document.querySelector("#prompt") as HTMLTextAreaElement)?.disabled;
  }, previous?.workspaceId);
}
async function query(text: string, match: string) {
  const input = page!.locator("#prompt");
  // Escape intentionally suppresses an unchanged query; simulate a fresh edit when reopening.
  await input.fill("");
  await input.fill(text);
  await input.press("End");
  const popup = page!.getByRole("listbox", { name: "pi 文件选择" });
  await popup.waitFor();
  await popup.getByRole("option").filter({ hasText: match }).first().waitFor();
  return popup;
}

try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  browser = await chromium.launch({ headless: true, executablePath: process.env.AXIOM_TEST_BROWSER });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  page = await context.newPage();
  page.setDefaultTimeout(12_000);
  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.routeWebSocket("**/ws", (route) => {
    const server = route.connectToServer();
    route.onMessage((message) => {
      const command = JSON.parse(message.toString()) as Command;
      commands.push(command);
      if (/^(prompt|agent\.(prompt|continue)|task\.(append|followup))$/.test(command.op)) {
        sends.push(command);
        route.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: false,
          error: { code: "TEST_BLOCKED", message: "Composer test blocks model execution" } }));
      } else server.send(message);
    });
    server.onMessage((message) => route.send(message));
  });
  await page.goto(app.accessUrl);
  await page.waitForFunction(() => document.body.innerText.includes("已连接本地服务"));
  await openWorkspace(project);
  const owner = await currentScope(), input = page.locator("#prompt");
  await page.locator("#model-picker > summary").click();
  await page.getByRole("button", { name: /^Composer Fixture/ }).click();
  await page.getByRole("button", { name: "确认模型设置", exact: true }).click();
  await input.fill("保留主会话草稿");
  await eventually(async () => page!.getByRole("button", { name: "发送消息", exact: true }).isEnabled(), "fixture model must be selected, so no-send checks are meaningful");

  for (const label of ["选择文件", "选择图片", "选择文件夹"]) {
    const state: { type: string; hidden: boolean | "until-found"; multiple: boolean; directory: boolean; accept: string } = await page.getByLabel(label, { exact: true }).evaluate((node: HTMLInputElement) => ({
      type: node.type, hidden: node.hidden, multiple: node.multiple, directory: node.hasAttribute("webkitdirectory"), accept: node.accept,
    }));
    assert.equal(state.type, "file"); assert.equal(state.hidden, true); assert.equal(state.multiple, true);
    assert.equal(state.directory, label === "选择文件夹");
    if (label === "选择图片") for (const format of ["png", "jpeg", "gif", "webp"]) assert.ok(state.accept.includes(format));
  }
  for (const [label, item] of [["选择文件", /^文件\s*支持多选/], ["选择图片", /^图片/], ["选择文件夹", /^文件夹/]] as const) {
    await page.getByRole("button", { name: "添加附件", exact: true }).click();
    const [chooser]: [FileChooser, unknown] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("menuitem", { name: item }).click(),
    ]);
    assert.equal(chooser.isMultiple(), true);
    assert.equal(await chooser.element().getAttribute("aria-label"), label);
    // Do not populate here: directory inputs cannot be cleared with an empty file list.
    // The real selections are exercised through setInputFiles below.
  }
  await page.getByRole("button", { name: "添加附件", exact: true }).click();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("menu", { name: "添加附件" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "添加附件", exact: true }).evaluate((node) => node === document.activeElement), true);
  passed.push("accessible + menu; hidden multiple file/image/folder inputs; chooser wiring; Escape focus");

  await page.getByLabel("选择文件", { exact: true }).setInputFiles([
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("中文 notes\n") },
    { name: "source.rs", mimeType: "application/octet-stream", buffer: Buffer.from("fn main() {}\n") },
  ]);
  await eventually(async () => await page!.locator(".attachment-chip").count() === 2, "both selected files must become chips");
  assert.deepEqual((await draft(owner)).attachments, [{ name: "notes.txt", text: "中文 notes\n" }, { name: "source.rs", text: "fn main() {}\n" }]);
  await page.getByRole("button", { name: "移除附件：notes.txt", exact: true }).click();
  assert.equal(await page.locator(".attachment-chip").count(), 1);
  assert.equal((await draft(owner)).attachments?.[0].name, "source.rs");
  await page.getByLabel("选择文件夹", { exact: true }).setInputFiles(folder);
  await eventually(async () => await page!.locator(".attachment-chip").count() === 3, "folder files must become separate chips");
  const folderAttachments = (await draft(owner)).attachments!;
  assert.ok(folderAttachments.some((a) => a.name === "upload folder/root.txt" && a.text === "folder root\n"));
  assert.ok(folderAttachments.some((a) => a.name === "upload folder/deep/中文.any" && a.text === "nested UTF-8 text\n"));

  const binary = Buffer.alloc(300_000, 255);
  binary[0] = 0; // >200 KB must cross the transport's large-upload allowlist.
  await page.getByLabel("选择文件", { exact: true }).setInputFiles({ name: "archive.bin", mimeType: "application/octet-stream", buffer: binary });
  await eventually(async () => !!(await draft(owner))?.attachments?.some((a) => a.name === "archive.bin"), "binary upload must finish");
  const uploaded = (await draft(owner)).attachments!.find((a) => a.name === "archive.bin")!;
  assert.match(uploaded.text, /未自动解析/);
  const uploadDir = join(app.store.root, "attachments", owner.workspaceId, owner.sessionId);
  const stored = readdirSync(uploadDir);
  assert.equal(stored.length, 1);
  assert.deepEqual(readFileSync(join(uploadDir, stored[0])), binary);
  assert.ok(commands.some((c) => c.op === "files.upload" && c.workspaceId === owner.workspaceId && c.sessionId === owner.sessionId));
  await page.getByLabel("选择图片", { exact: true }).setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "移除图片：pixel.png", exact: true }).waitFor();
  assert.equal((await draft(owner)).images?.[0].mimeType, "image/png");
  assert.equal(await input.inputValue(), "保留主会话草稿[imag1]");
  passed.push("multi-file chips/removal; folder relative paths; exact binary upload bytes/reference; image chip; preserved draft text");

  await checkImageComposer(page, png, artifacts);
  passed.push("image clipboard paste, cursor references, async typing, stable labels/removal, limits and reload");

  let popup = await query("Inspect @composer-al", "composer-alpha.ts");
  assert.equal(await popup.getByRole("option").count(), 1, "query filters the workspace fixture");
  await input.press("Enter");
  await eventually(async () => await input.inputValue() === "Inspect @composer-alpha.ts ", "Enter inserts selection instead of sending");
  assert.equal(sends.length, 0);
  popup = await query("@space", "space name.rs");
  await input.press("Tab");
  assert.equal(await input.inputValue(), '@"nested/space name.rs" ');
  popup = await query("@nest", "nested/");
  await popup.getByRole("option").filter({ hasText: "nested/" }).first().click();
  assert.equal(await input.inputValue(), "@nested/");
  popup = await query("@composer", "composer-alpha.ts");
  const labels = await popup.getByRole("option").allTextContents();
  assert.ok(!labels.some((label) => label.includes("foreign")), "must not search another workspace");
  await input.press("Escape");
  await popup.waitFor({ state: "hidden" });
  assert.equal(await input.inputValue(), "@composer");
  assert.equal(await input.evaluate((node) => node === document.activeElement), true);
  await query("@composer-al", "composer-alpha.ts");
  await input.dispatchEvent("compositionstart");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, keyCode: 229 });
  assert.equal(await input.inputValue(), "@composer-al");
  assert.equal(sends.length, 0, "IME Enter never submits");
  await input.dispatchEvent("compositionend");
  await input.press("Escape");
  await input.fill("dev@example.com");
  assert.equal(await page.getByRole("listbox", { name: "pi 文件选择" }).count(), 0);
  passed.push("real pi workspace filtering; Enter/Tab insertion without send; quoted file and folder paths; Escape; IME; email exclusion");

  // Session/workspace switches must not leak attachments or completion scope.
  await input.fill("parent retained");
  await page.locator("#new-chat").click();
  await eventually(async () => (await currentScope()).sessionId !== owner.sessionId, "new session must open");
  assert.equal(await input.inputValue(), "");
  assert.equal(await page.locator(".attachment-chip").count(), 0);
  await query("@composer-al", "composer-alpha.ts");
  const second = await currentScope();
  assert.ok(commands.some((c) => c.op === "files.complete" && c.sessionId === second.sessionId));
  await input.press("Escape");
  await openWorkspace(other);
  popup = await query("@composer", "composer-foreign.txt");
  assert.equal(await popup.getByRole("option").count(), 1);
  assert.equal(await page.locator(".attachment-chip").count(), 0);
  assert.equal((await draft(owner)).text, "parent retained");
  assert.equal((await draft(owner)).attachments?.length, 4);
  passed.push("independent session drafts and completion scope; workspace A/B search isolation");

  // Show representative long chips alongside an open picker at both requested widths.
  await input.press("Escape");
  await page.getByLabel("选择文件夹", { exact: true }).setInputFiles(folder);
  await eventually(async () => await page!.locator(".attachment-chip").count() === 2, "screenshot attachment fixtures");
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await query(`Viewport ${width} @composer`, "composer-foreign.txt");
    await page.screenshot({ path: join(artifacts, `composer-${width}.png`), fullPage: true });
    const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(dimensions.scroll <= dimensions.client + 1, `${width}px horizontal overflow: ${JSON.stringify(dimensions)}`);
    await input.press("Escape");
    await page.getByRole("button", { name: "添加附件", exact: true }).click();
    await page.screenshot({ path: join(artifacts, `composer-menu-${width}.png`), fullPage: true });
    await page.keyboard.press("Escape");
  }
  assert.equal(sends.length, 0, "completion interactions must never send a prompt");
  passed.push("390/1440 screenshots and document overflow checks");

  // Large images stay in page memory and cross WS only on explicit send.
  const largePng = Buffer.concat([png, Buffer.alloc(420_000, 0)]);
  await page.getByLabel("选择图片", { exact: true }).setInputFiles({ name: "large.png", mimeType: "image/png", buffer: largePng });
  await page.getByRole("button", { name: "移除图片：large.png", exact: true }).waitFor();
  const largeOwner = await currentScope();
  assert.equal((await draft(largeOwner)).images?.[0].data, largePng.toString("base64"));
  assert.ok(!commands.some((command) => command.op.startsWith("draft.")), "typing and selecting attachments never use a draft API");
  assert.equal(await page.evaluate(() => Object.keys(sessionStorage).some((key) => key.startsWith("draft:"))), false);
  assert.equal(sends.length, 0, "selecting an image must not send");
  // Test the large prompt browser transport, but block delivery to any model worker.
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await eventually(async () => sends.length === 1, "explicit large-image prompt must reach the websocket transport");
  const sent = sends[0].params as { images: Array<{ data: string }> };
  assert.equal(sent.images[0].data, largePng.toString("base64"));
  assert.equal(sends[0].workspaceId, largeOwner.workspaceId);
  assert.equal(sends[0].sessionId, largeOwner.sessionId);
  await page.reload();
  await page.waitForFunction(() => document.body.innerText.includes("已连接本地服务"));
  assert.equal(await input.inputValue(), "", "reload discards unsent input");
  assert.equal(await page.locator(".image-chip, .attachment-chip, .draft-recovery").count(), 0, "reload has neither attachments nor a recovery gate");
  assert.equal(sends.length, 1, "reload cannot replay the blocked prompt");
  assert.deepEqual(errors, [], "no browser runtime/console errors");
  passed.push(">200 KB binary upload; >512 KB in-memory image; explicit large prompt reaches blocked WS boundary; reload discards drafts without replay");
  console.log(`PASS: ${passed.join("; ")}. Screenshots: ${artifacts}. Child-task modal and actual model submission are outside this runner.`);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(artifacts, "failure.png"), fullPage: true }).catch(() => {});
    console.error("Completed:", passed, "\nBrowser errors:", errors, "\nPage:", await page.locator("body").innerText().catch(() => "unavailable"));
  }
  throw error;
} finally {
  try { await browser?.close(); } finally {
    try { await app?.close(); } finally {
      if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
      else process.env.AXIOM_PI_DIR = previousPi;
      rmSync(root, { recursive: true, force: true });
    }
  }
}
