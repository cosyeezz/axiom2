import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { memoryDirectory } from "../src/server/memory-files.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-memory-navigation-")), project = join(root, "project");
mkdirSync(project);
const output = process.env.AXIOM_TEST_ARTIFACTS || mkdtempSync(join(tmpdir(), "axiom-memory-navigation-shots-"));
mkdirSync(output, { recursive: true });
const app = await startServer({ root, port: 0, dev: process.env.AXIOM_TEST_PRODUCTION !== "1" });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id }, directory = memoryDirectory(root, session.id);
  mkdirSync(join(directory, "references"), { recursive: true });
  writeFileSync(join(directory, "MEMORY.md"), "# [In progress] 导航位置验证\n");
  writeFileSync(join(directory, "references", "short.md"), "# 简短详情\n\n跳转应紧随这段正文下方。\n");
  writeFileSync(join(directory, "references", "long.md"), "# 长篇详情\n\n" + "这是一段用于验证滚动和返回入口的长正文。\n\n".repeat(100));
  app.agents.memories.scan(scope);
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(current => sessionStorage.setItem("view", JSON.stringify(current)), scope);
  await page.goto(app.origin);
  await page.getByRole("button", { name: "上下文与会话记忆", exact: true }).click();
  await page.getByRole("dialog", { name: "上下文与会话记忆", exact: true }).getByRole("button", { name: "查看完整记忆", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "会话记忆", exact: true });
  await panel.locator(".memory-related > summary").click();
  await panel.getByRole("button", { name: "references/short.md", exact: true }).waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await panel.getByRole("button", { name: "references/short.md", exact: true }).click();
    await panel.getByText("跳转应紧随这段正文下方。", { exact: true }).waitFor();
    const documentBox = (await panel.locator(".memory-document").boundingBox())!;
    const footerBox = (await panel.locator(":scope > footer").boundingBox())!;
    const panelBox = (await panel.boundingBox())!;
    assert.ok(footerBox.y >= documentBox.y + documentBox.height - 1, "navigation follows content without overlap");
    assert.ok(footerBox.y - (documentBox.y + documentBox.height) <= 24, "navigation immediately follows short content");
    assert.ok(footerBox.y + footerBox.height < panelBox.y + panelBox.height - 100, "short content does not push navigation to drawer bottom");
    assert.equal(await panel.evaluate(node => node.scrollWidth > node.clientWidth + 1), false);
    await page.screenshot({ path: join(output, `short-${width}.png`) });
    await panel.getByRole("button", { name: "返回上一级", exact: true }).click();
    await panel.getByRole("button", { name: "references/long.md", exact: true }).click();
    await panel.getByRole("heading", { name: "长篇详情", exact: true }).waitFor();
    const header = await panel.locator(":scope > header").boundingBox(), footer = await panel.locator(":scope > footer").boundingBox();
    const scroll = await panel.locator(".memory-dialog-body").evaluate(node => { node.scrollTop = node.scrollHeight; return node.scrollTop; });
    assert.ok(scroll > 300, "long documents remain scrollable");
    assert.deepEqual(await panel.locator(":scope > header").boundingBox(), header);
    assert.deepEqual(await panel.locator(":scope > footer").boundingBox(), footer);
    assert.ok(await panel.getByRole("button", { name: "返回上一级", exact: true }).isVisible());
    await page.screenshot({ path: join(output, `long-${width}.png`) });
    await panel.getByRole("button", { name: "返回上一级", exact: true }).click();
    await panel.getByRole("button", { name: "references/short.md", exact: true }).waitFor();
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: short-content navigation, long-document scrolling and return navigation at 1440/390px. Screenshots: ${output}`);
} finally {
  await browser.close(); await app.close(); rmSync(root, { recursive: true, force: true });
}
