import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
import { tmpdir } from "./temporary.js";

const root = mkdtempSync(join(tmpdir(), "axiom-chapter-ui-"));
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS || "test-results/markdown-section");
mkdirSync(artifacts, { recursive: true }); mkdirSync(join(root, "pi"));
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  const text = "# 全文标题\n\n前文不能丢。\n\n## 10. 工具定义提示词定稿\n\n目标章节正文 [外链][ref]，脚注[^note]。\n\n### 10.1 子章节\n\n子章节正文\n\n## 11. 下一章节\n\n后文也不能丢。\n\n[ref]: https://example.com/reference\n[^note]: 末尾定义的脚注。\n";
  const file = join(root, "special#name.md"), href = "special%23name.md#10-工具定义提示词定稿";
  writeFileSync(file, text);
  const realFile = process.env.AXIOM_TEST_CHAPTER_FILE || fileURLToPath(new URL("../../docs/subagent-types-design.md", import.meta.url));
  const realHref = `${realFile}#10-工具定义提示词定稿`;
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  views.messageChanged(scope, { id: "chapter-reply", role: "assistant", text: `[目标章节](${href}) · [缺失章节](special%23name.md#missing) · [行号链接](special%23name.md#L5) · [编码章节](special%23name.md#10-%E5%B7%A5%E5%85%B7%E5%AE%9A%E4%B9%89%E6%8F%90%E7%A4%BA%E8%AF%8D%E5%AE%9A%E7%A8%BF) · [截图原文](<${realHref}>)` }); views.flush(scope);
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const errors: string[] = [], commands: { op: string; href: string }[] = [];
  const documentIds = new Set<string>();
  let onDocument: (() => void) | undefined;
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/ws", socket => {
    const server = socket.connectToServer();
    socket.onMessage(raw => {
      const command = JSON.parse(raw.toString());
      if (["files.document", "files.save"].includes(command.op)) commands.push({ op: command.op, href: command.params.href });
      if (command.op === "files.document") documentIds.add(command.requestId);
      server.send(raw);
    });
    server.onMessage(raw => {
      socket.send(raw);
      const reply = JSON.parse(raw.toString());
      if (documentIds.has(reply.requestId)) { assert.equal(reply.ok, true, JSON.stringify(reply.error)); onDocument?.(); }
    });
  });
  await page.addInitScript(value => { sessionStorage.setItem("view", JSON.stringify(value)); }, scope);
  await page.goto(app.origin);
  const open = async (name: string) => { await page.getByRole("button", { name, exact: true }).click(); await page.locator('.file-preview-body[aria-busy="false"]').waitFor(); };
  const close = async () => { await page.getByRole("button", { name: "关闭文件预览", exact: true }).click(); await page.locator(".file-preview-panel").waitFor({ state: "detached" }); };
  const reading = page.locator(".file-reading"), bar = page.locator(".file-section-bar");
  const chapterOnly = async () => {
    const body = await reading.innerText();
    assert.ok(body.includes("子章节正文")); assert.ok(!body.includes("全文标题")); assert.ok(!body.includes("后文也不能丢"));
    assert.ok(body.includes("末尾定义的脚注"));
    assert.equal(await reading.locator('a[href="https://example.com/reference"]').count(), 1);
    assert.equal(await page.getByRole("button", { name: "返回全文", exact: true }).count(), 1);
  };
  await open("目标章节"); await chapterOnly();
  const beforeToggle = commands.length;
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole("button", { name: "Markdown 源码", exact: true }).click();
    const source = await page.locator(".file-source-code pre").innerText();
    assert.ok(source.startsWith("## 10.")); assert.ok(!source.includes("后文也不能丢"));
    assert.equal((await page.locator(".file-source-lines").innerText()).split("\n")[0], "5");
    await page.getByRole("button", { name: "Markdown 阅读", exact: true }).click();
    await chapterOnly(); await page.screenshot({ path: join(artifacts, `chapter-${width}.png`) });
    await page.getByRole("button", { name: "返回全文", exact: true }).click();
    assert.ok((await reading.innerText()).includes("全文标题")); assert.ok((await reading.innerText()).includes("后文也不能丢"));
    await page.screenshot({ path: join(artifacts, `full-${width}.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const panel = (await page.locator(".file-preview-panel").boundingBox())!, button = (await page.getByRole("button", { name: "查看链接章节", exact: true }).boundingBox())!;
    assert.ok(button.x >= panel.x && button.x + button.width <= panel.x + panel.width + 1);
    await page.getByRole("button", { name: "查看链接章节", exact: true }).click();
  }
  assert.equal(commands.length, beforeToggle, "full/chapter switches must remain local and keep the original reference");
  await page.getByRole("button", { name: "编辑全文", exact: true }).click();
  assert.equal(await page.locator(".file-editor").inputValue(), text);
  const edited = text.replace("目标章节正文", "编辑后的章节正文");
  await page.locator(".file-editor").fill(edited); await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.locator(".file-editor").waitFor({ state: "detached" });
  assert.equal(readFileSync(file, "utf8"), edited);
  assert.ok(commands.some(command => command.op === "files.save" && command.href === href));
  await page.getByRole("button", { name: "查看链接章节", exact: true }).click();
  await page.getByRole("button", { name: "Markdown 阅读", exact: true }).click(); await chapterOnly();
  assert.ok((await reading.innerText()).includes("编辑后的章节正文"));
  const reloaded = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chapter reload timed out")), 10000);
    onDocument = () => { clearTimeout(timer); onDocument = undefined; resolve(); };
  });
  await page.getByRole("button", { name: "重新加载文件", exact: true }).click();
  await reloaded;
  await page.locator('.file-preview-body[aria-busy="false"]').waitFor();
  await chapterOnly();
  assert.ok(commands.every(command => command.href === href));
  await close();
  await open("缺失章节"); assert.ok((await bar.innerText()).includes("未找到章节 #missing"));
  assert.ok((await reading.innerText()).includes("全文标题")); assert.equal(await page.getByRole("button", { name: "返回全文", exact: true }).count(), 0); await close();
  await open("行号链接"); assert.equal(await bar.count(), 0); assert.ok((await page.locator(".file-source-code pre").innerText()).includes("全文标题")); await close();
  await open("编码章节"); await chapterOnly(); await close();
  await open("截图原文");
  assert.equal(await page.locator('.file-preview-body [role="alert"]').count(), 0);
  assert.ok((await reading.innerText()).startsWith("10. 工具定义提示词定稿"));
  await page.screenshot({ path: join(artifacts, "original-chapter-390.png") });
  await page.getByRole("button", { name: "返回全文", exact: true }).click();
  assert.equal(await reading.locator("h1").count(), 1);
  assert.deepEqual(errors, []);
  const result = { widths: [1440, 390], realHref, commands, pageErrors: errors, savedFullDocument: true, missingFallsBack: true, encodedFragment: true, lineLinksPreserved: true };
  writeFileSync(join(artifacts, "result.json"), JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify({ ...result, artifacts }, null, 2));
} finally {
  await browser?.close(); await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
