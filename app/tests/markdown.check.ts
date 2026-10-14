// Run: npx tsx tests/markdown.check.ts
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-markdown-"));
const artifacts = resolve("test-results/markdown");
mkdirSync(artifacts, { recursive: true });
mkdirSync(join(root, "pi"));
const previous = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const w = app.store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: root, authorized: true } }) as Workspace;
  const s = app.store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: w.id }) as Session;
  const scope = { workspaceId: w.id, sessionId: s.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const publish = (text: string, streaming: boolean) => {
    views.messageChanged(scope, { id: "markdown-regression", role: "assistant", text, streaming });
    views.flush(scope);
  };
  publish("**验证：", true);
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ permissions: ["clipboard-read", "clipboard-write"] });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((value) => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  const message = page.locator('[aria-label="助手回复"] .markdown');
  await message.waitFor();
  assert.equal(await message.locator("strong").count(), 0);
  const source = "- 保留撤回、失败恢复和迟到回执去重。\n\n**验证：**43 项相关测试、25 项 Steering 浏览器检查通过。\n\n`**验证：**43`\n\n```text\n**验证：**43\n```";
  publish(source, false);
  await message.locator("strong").waitFor();
  assert.equal(await message.locator("strong").innerText(), "验证：");
  assert.ok((await message.locator("p").first().innerText()).startsWith("验证：43"));
  assert.equal(await message.locator("code").first().innerText(), "**验证：**43");
  assert.equal(await message.locator("pre code").innerText(), "**验证：**43");
  await page.getByRole("button", { name: "复制回复的 Markdown 原文" }).focus();
  await page.getByRole("button", { name: "复制回复的 Markdown 原文" }).click();
  // Windows clipboard normalizes line endings to CRLF.
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n"), source);
  for (const width of [375, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(artifacts, `markdown-${width}.png`) });
  }
  await page.reload();
  await message.locator("strong").waitFor();
  assert.equal(await message.locator("strong").innerText(), "验证：");
  assert.deepEqual(errors, []);
  console.log("PASS: Chinese bold, streaming completion, literal code, unchanged clipboard, reload and 3 widths");
} finally {
  await browser?.close();
  await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
