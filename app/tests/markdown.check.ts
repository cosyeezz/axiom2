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
    views.messageChanged(scope, { id: "markdown-regression", role: "assistant", phase: "final_answer", text, streaming });
    views.flush(scope);
  };
  publish("**验证：", true);
  const userSource = "第一行\n**第二行**\n第三行\n\n- 列表项\n\n```text\n代码第一行\n代码第二行\n```";
  views.messageChanged(scope, { id: "user-newline-regression", role: "user", text: userSource, streaming: false });
  views.flush(scope);
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ permissions: ["clipboard-read", "clipboard-write"] });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((value) => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  const message = page.locator('[aria-label="助手回复"] .markdown');
  await message.waitFor();
  const userMessage = page.locator('[aria-label="用户消息"] .markdown');
  await userMessage.locator("strong").waitFor();
  assert.equal(await userMessage.locator("p").first().innerText(), "第一行\n第二行\n第三行");
  assert.equal(await userMessage.locator("br").count(), 2);
  assert.equal(await userMessage.locator("li").innerText(), "列表项");
  assert.equal(await userMessage.locator("pre code").innerText(), "代码第一行\n代码第二行");
  assert.equal(await message.locator("strong").count(), 0);
  const quote = "“整理索引时检查冲突，核实后修正或删除；用户明确否定的内容直接删除”";
  const quotedSource = `可以，简化为**${quote}**就够了。`;
  publish(`可以，简化为**${quote.slice(0, -1)}`, true);
  await page.waitForFunction(() => document.querySelector('[aria-label="助手回复"] .markdown')?.textContent?.startsWith("可以，简化为**“整理"));
  assert.equal(await message.locator("strong").count(), 0);
  const source = `- 保留撤回、失败恢复和迟到回执去重。\n\n**验证：**43 项相关测试、25 项 Steering 浏览器检查通过。\n\n${quotedSource}\n\n\`**验证：**43\`\n\n\`\`\`text\n${quotedSource}\n\`\`\``;
  publish(source, false);
  await message.locator("strong").nth(1).waitFor();
  assert.deepEqual(await message.locator("strong").allTextContents(), ["验证：", quote]);
  assert.ok((await message.locator("p").first().innerText()).startsWith("验证：43"));
  assert.equal(await message.locator("code").first().innerText(), "**验证：**43");
  assert.equal(await message.locator("pre code").innerText(), quotedSource);
  await page.getByRole("button", { name: "复制回复的 Markdown 原文" }).focus();
  await page.getByRole("button", { name: "复制回复的 Markdown 原文" }).click();
  // Windows clipboard normalizes line endings to CRLF.
  assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n"), source);
  for (const width of [375, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const lineTops = await userMessage.locator("p").first().evaluate((element) => Array.from(element.children)
      .filter((child) => child.tagName !== "BR").map((child) => child.getBoundingClientRect().top));
    assert.ok(lineTops[0] < lineTops[1] && lineTops[1] < lineTops[2], `visible input newlines at ${width}px`);
    await page.screenshot({ path: join(artifacts, `markdown-${width}.png`) });
  }
  await page.reload();
  await message.locator("strong").nth(1).waitFor();
  assert.deepEqual(await message.locator("strong").allTextContents(), ["验证：", quote]);
  assert.equal(await userMessage.locator("p").first().innerText(), "第一行\n第二行\n第三行");
  assert.deepEqual(errors, []);
  console.log("PASS: user message newlines, Markdown lists/code, Chinese bold, streaming completion, unchanged clipboard, reload and 3 widths");
} finally {
  await browser?.close();
  await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
