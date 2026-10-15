// Standalone: npm exec tsx tests/attachment-paths.check.ts
// Current Vite source, isolated pi/data/workspaces. Mock only the OS picker HTTP
// boundary and block model execution; clipboard bytes use the real files.upload.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Command, Draft, PickedAttachment, Scope, Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-attachment-paths-"));
const project = join(root, "项目 A"), external = join(root, "外部附件 空格"), pi = join(root, "pi");
for (const dir of [project, external, pi]) mkdirSync(dir, { recursive: true });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1kAAAAASUVORK5CYII=", "base64");
const mixed: PickedAttachment[] = [
  { name: "中文 notes.txt", path: join(external, "中文 notes.txt"), kind: "file" },
  { name: "pixel.png", path: join(external, "pixel.png"), kind: "image" },
  { name: "项目资料", path: join(external, "项目资料"), kind: "folder" },
  { name: "second.bin", path: join(external, "second.bin"), kind: "file" },
];
writeFileSync(mixed[0].path, "DO NOT INLINE THIS FILE\n");
writeFileSync(mixed[1].path, png);
mkdirSync(mixed[2].path);
writeFileSync(mixed[3].path, Buffer.from([0, 255, 7]));
writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: {
  "attachment-fixture": { api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1",
    models: [{ id: "fixture", name: "Attachment Fixture", input: ["text"] }] },
} }));
writeFileSync(join(pi, "auth.json"), JSON.stringify({ "attachment-fixture": { type: "api_key", key: "isolated-test-only" } }));
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = pi;
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined, page: Page | undefined;
const errors: string[] = [], commands: Command[] = [], sends: Command[] = [], passed: string[] = [];
function gate() {
  let release!: () => void;
  const wait = new Promise<void>((done) => { release = done; });
  return { wait, release };
}
let pickerGate: ReturnType<typeof gate> | undefined, uploadGate: ReturnType<typeof gate> | undefined;
let items: PickedAttachment[] = [], calls = 0;
async function eventually(check: () => Promise<boolean>, message: string) {
  const deadline = Date.now() + 12_000;
  do {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 30));
  } while (Date.now() < deadline);
  assert.fail(message);
}
async function draft(scope: Scope): Promise<Draft> {
  return page!.evaluate(async (owner) => {
    const modulePath = "/drafts.ts";
    return (await import(/* @vite-ignore */ modulePath)).getDraft(owner);
  }, scope);
}
async function paste(name: string) {
  await page!.locator("#prompt").evaluate((node, args) => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(args.bytes), (c) => c.charCodeAt(0))], args.name, { type: "image/png" }));
    node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, { name, bytes: png.toString("base64") });
}
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const seedSession = (title: string) => {
    const session = app!.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    app!.store.execute({ requestId: randomUUID(), op: "session.rename", workspaceId: workspace.id, sessionId: session.id, params: { title } });
    app!.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET selection=excluded.selection")
      .run(session.id, JSON.stringify({ provider: "attachment-fixture", id: "fixture", thinking: "off" }));
    return { workspaceId: workspace.id, sessionId: session.id };
  };
  const owner = seedSession("附件测试 A"), other = seedSession("附件测试 B");
  browser = await chromium.launch({ headless: true, executablePath: process.env.AXIOM_TEST_BROWSER });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(12_000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((scope) => sessionStorage.setItem("view", JSON.stringify(scope)), owner);
  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/attachments/pick?*", async (route) => {
    calls++;
    const url = new URL(route.request().url());
    assert.equal(route.request().method(), "POST");
    assert.equal(url.searchParams.get("workspaceId"), owner.workspaceId);
    assert.equal(url.searchParams.get("sessionId"), owner.sessionId);
    assert.equal(url.searchParams.get("kind"), "mixed");
    assert.equal(url.searchParams.get("multiple"), "true");
    const captured = items;
    await pickerGate?.wait;
    await route.fulfill({ json: { items: captured } });
  });
  await page.routeWebSocket("**/ws", (route) => {
    const server = route.connectToServer();
    route.onMessage(async (raw) => {
      const command = JSON.parse(raw.toString()) as Command;
      commands.push(command);
      if (/^(prompt|agent\.(prompt|continue)|task\.(append|followup))$/.test(command.op)) {
        sends.push(command);
        route.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: false,
          error: { code: "TEST_BLOCKED", message: "Attachment smoke test blocks model execution" } }));
      } else {
        if (command.op === "files.upload") await uploadGate?.wait;
        server.send(raw);
      }
    });
    server.onMessage((raw) => route.send(raw));
  });
  await page.goto(app.accessUrl);
  const input = page.locator("#prompt"), add = page.getByRole("button", { name: "添加附件", exact: true });
  const send = page.getByRole("button", { name: "发送消息", exact: true });
  await eventually(async () => input.isEnabled(), "seeded composer must mount");
  await input.fill("前文选中后文");
  await eventually(async () => send.isEnabled(), "text-only fixture model must allow sending");
  await input.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(2, 4));
  items = mixed;
  const sizes = [360, 390, 430, 600, 820, 1024, 1366, 1440, 1920];
  const composerShape = () => page!.locator(".composer").evaluate((form) => {
    const box = form.getBoundingClientRect(), input = form.querySelector("textarea")!.getBoundingClientRect();
    return { height: box.height, inputHeight: input.height, inputWidth: input.width, inputOffset: input.top - box.top };
  });
  const shapes = new Map<number, Awaited<ReturnType<typeof composerShape>>>();
  for (const width of sizes) {
    await page.setViewportSize({ width, height: 900 });
    shapes.set(width, await composerShape());
  }
  pickerGate = gate();
  await add.click();
  await eventually(async () => calls === 1, "+ must directly request the native picker API");
  assert.equal(await page.getByRole("menu", { name: "添加附件" }).count(), 0);
  assert.equal(await page.locator('.composer-area input[type="file"]').count(), 0);
  assert.equal(await page.getByRole("button", { name: "取消选择", exact: true }).isEnabled(), true);
  assert.equal(await add.count(), 0, "the existing trigger changes to cancel instead of adding a second button");
  assert.equal(await send.isDisabled(), true);
  for (const width of sizes) {
    await page.setViewportSize({ width, height: 900 });
    assert.deepEqual(await composerShape(), shapes.get(width), `pending selector must not stretch the composer at ${width}px`);
    assert.deepEqual(await page.locator(".attachment-picker").evaluate((node) => ({
      width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height,
      buttons: node.querySelectorAll("button").length,
    })), { width: 44, height: 44, buttons: 1 });
    assert.ok(await page.locator(".composer").evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
    if (width === 390 || width === 1440) {
      const screenshots = resolve("test-results/open-dialog"); mkdirSync(screenshots, { recursive: true });
      await page.locator(".composer-area").screenshot({ path: join(screenshots, `pending-${width}.png`) });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  pickerGate.release(); pickerGate = undefined;
  await page.getByRole("button", { name: "移除附件：second.bin", exact: true }).waitFor();
  assert.equal(await input.inputValue(), "前文[file1] [imag1] [folder1] [file2]后文");
  assert.deepEqual((await draft(owner)).attachments, mixed.map((item, i) => ({ ...item, id: ["file1", "imag1", "folder1", "file2"][i], text: "" })));
  assert.deepEqual(await page.locator(".attachment-chip").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-tooltip"))), mixed.map((item) => item.path));
  assert.equal(await page.locator(".attachment-chip img").count(), 0);
  assert.equal(commands.filter((c) => c.op === "files.upload").length, 0, "local paths must not upload or expand folder contents");
  assert.equal(await send.isEnabled(), true, "image path does not require a vision model");
  passed.push("direct + API; fixed 44px cancel trigger; unchanged composer geometry at nine widths; mixed selection and path labels");

  const originalText = await input.inputValue();
  const overlay = page.locator(".attachment-input-overlay");
  await eventually(async () => await overlay.locator(".attachment-reference-icon").count() === 4, "all bound references render as icons");
  assert.equal(await page.locator(".attachment-chip .attachment-symbol").count(), 4);
  assert.deepEqual(await overlay.locator(".attachment-symbol small").allTextContents(), ["1", "1", "1", "2"]);
  assert.equal(await page.locator('.attachment-label[aria-label^="文件夹"] .attachment-name').textContent(), "项目资料", "folder label uses this selection's name, not the workspace name");
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await eventually(async () => input.evaluate((node) => node.scrollHeight <= node.clientHeight + 1), "short wrapped input grows to show every line");
    const screenshots = resolve("test-results/attachment-icons"); mkdirSync(screenshots, { recursive: true });
    await page.locator(".composer-area").screenshot({ path: join(screenshots, `icons-${width}.png`) });
    const geometry = await input.evaluate((node) => {
      const layer = document.querySelector<HTMLElement>(".attachment-input-overlay")!;
      const a = node.getBoundingClientRect(), b = layer.getBoundingClientRect();
      return { x: Math.abs(a.x - b.x), y: Math.abs(a.y - b.y), width: Math.abs(node.clientWidth - b.width) };
    });
    assert.ok(geometry.x < 1 && geometry.y < 1 && geometry.width < 1, "mirror matches native textarea geometry");
  }
  await input.focus();
  await input.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(5, 5));
  await eventually(async () => await overlay.locator(".attachment-reference-icon").count() === 3, "caret inside reference reveals editable text");
  await input.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(node.value.length, node.value.length));
  await eventually(async () => await overlay.locator(".attachment-reference-icon").count() === 4, "leaving reference restores icon");
  await input.evaluate((node) => node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
  await eventually(async () => await overlay.locator(".attachment-reference-icon").count() === 0, "IME exposes native text");
  await input.evaluate((node) => node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
  await input.fill(`${"多行输入 abc\n".repeat(15)}${originalText} [file999]`);
  await input.evaluate((node) => { node.scrollTop = node.scrollHeight; node.dispatchEvent(new Event("scroll")); });
  await eventually(async () => input.evaluate((node) => Math.abs(node.scrollTop - document.querySelector(".attachment-input-overlay")!.scrollTop) < 1), "mirror tracks native scroll");
  assert.equal(await overlay.locator(".attachment-reference-icon").count(), 4, "unknown references stay plain text");
  await input.fill(originalText);
  await page.setViewportSize({ width: 1440, height: 900 });
  passed.push("attachment icons at desktop/mobile widths; caret editing, IME, multiline scroll and unknown references preserve native text");

  await input.fill(`${await input.inputValue()} 再次[file1]`);
  await page.getByRole("button", { name: "移除附件：中文 notes.txt", exact: true }).click();
  assert.equal(await input.inputValue(), "前文 [imag1] [folder1] [file2]后文 再次");
  assert.deepEqual((await draft(owner)).attachments?.map((a) => a.id), ["imag1", "folder1", "file2"]);
  const beforeCancel = await draft(owner);
  items = [];
  await Promise.all([page.waitForResponse("**/api/attachments/pick?*"), add.click()]);
  await eventually(async () => add.isEnabled(), "cancel must finish picker");
  assert.deepEqual(await draft(owner), beforeCancel);
  passed.push("removal clears every matching reference without renumbering; cancel leaves draft unchanged");

  await input.fill("开始结束");
  await input.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(2, 2));
  items = [mixed[0]];
  pickerGate = gate();
  await add.click();
  await eventually(async () => calls === 3, "delayed picker must start");
  await input.focus();
  await input.pressSequentially("继续输入");
  const typed = await input.inputValue();
  assert.equal(typed, "开始继续输入结束");
  await input.press("Enter");
  assert.equal(sends.length, 0, "Enter must not submit a half-finished selection");
  pickerGate.release(); pickerGate = undefined;
  await page.getByRole("button", { name: "移除附件：中文 notes.txt", exact: true }).waitFor();
  assert.equal(await input.inputValue(), `${typed}[file3]`);
  assert.deepEqual((await draft(owner)).attachments?.map((a) => a.id), ["imag1", "folder1", "file2", "file3"]);
  passed.push("async picker preserves continued typing and existing IDs; blocks premature submission");

  const beforeAbort = await draft(owner);
  pickerGate = gate();
  await add.click();
  await page.getByRole("button", { name: "取消选择", exact: true }).click();
  await eventually(async () => add.isEnabled(), "browser cancellation must release the composer immediately");
  assert.deepEqual(await draft(owner), beforeAbort);
  pickerGate.release(); pickerGate = undefined;
  await page.waitForTimeout(100);
  assert.deepEqual(await draft(owner), beforeAbort, "late cancelled response cannot add attachments");
  passed.push("browser cancel unlocks composer and ignores late selection response");

  // Hold only the client-to-server upload frame: after release the real scoped
  // service writes bytes and returns path metadata. Navigate while it is pending.
  await input.fill("粘贴结束");
  await input.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(2, 2));
  uploadGate = gate();
  await paste("clipboard.png");
  await eventually(async () => commands.some((c) => c.op === "files.upload"), "paste must use files.upload");
  assert.equal(await input.inputValue(), "粘贴[imag2]结束", "reserve placeholder before asynchronous upload");
  await input.pressSequentially("继续输入");
  assert.equal(await input.inputValue(), "粘贴[imag2]继续输入结束");
  assert.equal(await send.isDisabled(), true);
  await page.locator("#history .history-item").filter({ hasText: "附件测试 B" }).click();
  await eventually(async () => await input.inputValue() === "", "second session has a separate draft");
  await input.fill("B 不应收到附件");
  uploadGate.release(); uploadGate = undefined;
  await eventually(async () => !!(await draft(owner)).attachments?.some((a) => a.name === "clipboard.png"), "late upload must attach to its captured session");
  assert.equal(await input.inputValue(), "B 不应收到附件");
  assert.deepEqual((await draft(other)).attachments, []);
  assert.equal(await page.locator(".attachment-chip").count(), 0);
  const uploaded = (await draft(owner)).attachments!.find((a) => a.name === "clipboard.png")!;
  assert.equal(uploaded.id, "imag2"); assert.equal(uploaded.kind, "image"); assert.equal(uploaded.text, "");
  assert.ok(uploaded.path);
  const uploadDir = resolve(app.store.root, "attachments", owner.workspaceId, owner.sessionId);
  assert.equal(dirname(uploaded.path), uploadDir);
  assert.notEqual(uploaded.path, join(uploadDir, "clipboard.png"), "server chooses storage basename");
  assert.deepEqual(readFileSync(uploaded.path), png);
  assert.equal(readdirSync(uploadDir).length, 1);
  const upload = commands.find((c) => c.op === "files.upload")!;
  assert.equal(upload.workspaceId, owner.workspaceId); assert.equal(upload.sessionId, owner.sessionId);
  assert.equal(upload.params?.id, "imag2"); assert.equal(upload.params?.kind, "image");
  await page.locator("#history .history-item").filter({ hasText: "附件测试 A" }).click();
  await eventually(async () => await input.inputValue() === "粘贴[imag2]继续输入结束", "returning to owner restores pending text and references");
  passed.push("clipboard reserves cursor reference; continued typing; late real upload stays in original session; exact scoped bytes");

  // Exercise the actual path-based paste flow, not a synthetic inline-image component.
  const previewTrigger = page.getByRole("button", { name: "预览图片：imag2", exact: true });
  const preview = page.getByRole("dialog", { name: "图片预览 · imag2", exact: true });
  const beforePreview = await draft(owner);
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await previewTrigger.click();
    await preview.waitFor();
    await page.waitForFunction(() => {
      const image = document.querySelector<HTMLImageElement>(".image-preview img");
      return image?.complete && image.naturalWidth > 0;
    });
    assert.equal(await preview.getByRole("img").getAttribute("src"), `data:image/png;base64,${png.toString("base64")}`);
    await preview.getByRole("img").click();
    assert.equal(await preview.isVisible(), true);
    const bounds = await preview.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= height);
    await page.keyboard.press("Escape");
    await preview.waitFor({ state: "detached" });
    assert.equal(await previewTrigger.evaluate((node) => node === document.activeElement), true);
    await previewTrigger.press("Enter");
    await preview.waitFor();
    await preview.getByRole("button", { name: "关闭图片预览" }).click();
    await preview.waitFor({ state: "detached" });
  }
  assert.deepEqual(await draft(owner), beforePreview);
  assert.equal(sends.length, 0, "preview cannot send a prompt");
  assert.ok(commands.some((c) => c.op === "files.preview" && c.workspaceId === owner.workspaceId && c.sessionId === owner.sessionId));
  passed.push("real clipboard path preview via scoped server read; image decoded; keyboard/close/focus; draft unchanged; 390/1440");

  const plainPrevented = await input.evaluate((node) => {
    const data = new DataTransfer(); data.setData("text/plain", "plain text");
    return !node.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  assert.equal(plainPrevented, false, "plain text paste retains native behavior");
  const submitted = await draft(owner);
  await eventually(async () => send.isEnabled(), "completed path uploads must enable send for text-only model");
  await send.click();
  await eventually(async () => sends.length === 1, "explicit send must reach intercepted prompt");
  const sent = sends[0];
  assert.equal(sent.op, "prompt"); assert.equal(sent.workspaceId, owner.workspaceId); assert.equal(sent.sessionId, owner.sessionId);
  assert.equal(sent.params?.text, submitted.text);
  assert.deepEqual(sent.params?.attachments, submitted.attachments);
  assert.deepEqual(sent.params?.images, [], "paths are not native model image payloads");
  assert.equal(JSON.stringify(sent.params).includes(png.toString("base64")), false);
  assert.equal(JSON.stringify(sent.params).includes("DO NOT INLINE THIS FILE"), false);
  await page.getByRole("status").filter({ hasText: "Attachment smoke test blocks model execution" }).waitFor();
  assert.deepEqual(await draft(owner), submitted, "confirmed rejection automatically preserves all selected paths");
  assert.equal(await page.getByRole("button", { name: "恢复到输入框", exact: true }).count(), 0);
  assert.equal(app.store.db.prepare("SELECT count(*) AS n FROM runs").get()!.n, 0);
  await page.getByRole("button", { name: "移除附件：clipboard.png", exact: true }).click();
  assert.equal(await input.inputValue(), "粘贴继续输入结束");
  assert.deepEqual(readFileSync(uploaded.path), png, "removal does not delete the stored clipboard copy");
  assert.deepEqual(readFileSync(mixed[1].path), png, "original paths remain untouched");
  assert.deepEqual(errors, []);
  passed.push("outgoing prompt carries exact path metadata, no contents/native images; no model run; removal retains files");
  console.log(`attachment paths UI: ${passed.length} groups passed\n- ${passed.join("\n- ")}`);
} finally {
  pickerGate?.release(); uploadGate?.release();
  try { await browser?.close(); } finally {
    try { await app?.close(); } finally {
      if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
      else process.env.AXIOM_PI_DIR = previousPi;
      rmSync(root, { recursive: true, force: true });
    }
  }
}
