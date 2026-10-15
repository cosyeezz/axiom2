import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import { chatMessage } from "../src/server/transcript.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-feedback-"));
const artifacts = resolve("test-results/chat-feedback");
mkdirSync(artifacts, { recursive: true }); mkdirSync(join(root, "pi"));
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const w = app.store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: root, authorized: true } }) as Workspace;
  const s = app.store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: w.id }) as Session;
  const scope = { workspaceId: w.id, sessionId: s.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  for (const status of ["completed", "cancelled", "failed", "interrupted", "unknown"])
    views.messageChanged(scope, chatMessage({ role: "custom", customType: "axiom-result", display: true, content: JSON.stringify({ taskId: "secret-task", runId: "secret-run", resultId: "secret-result", status }) }, status)!);
  const reasoning = { role: "assistant", content: [{ type: "thinking", thinking: "先检查**消息的展示边界**，再保留内部数据。\n\n### 检查标题\n\n| 检查项 |\n| --- |\n| 字重 |\n\n`const ready = true`\n\n```js\nconst ready = true;\n```" }, { type: "toolCall", id: "read", name: "read", arguments: { path: "src/server/transcript.ts" } }] };
  views.messageChanged(scope, chatMessage(reasoning, "reasoning", true)!);
  views.messageChanged(scope, { id: "tool-read", role: "toolResult", text: "done", status: "completed" });
  views.flush(scope);
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((value) => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  await page.locator(".task-notice").first().waitFor({ state: "attached" });
  assert.equal(await page.locator(".task-notice").count(), 5);
  assert.equal(await page.locator(".task-notice svg").count(), 5);
  assert.ok(!(await page.locator("#messages").innerText()).includes("secret-"));
  assert.equal(await page.locator(".task-notice").first().evaluate((n) => getComputedStyle(n).animationName), "none");
  await page.locator(".tool-activity > summary").click();
  const thinking = page.locator(".thinking-block");
  assert.ok(await thinking.locator(".thinking-body").isVisible(), "opening the process shows thinking directly");
  assert.equal(await thinking.locator("summary, .thinking-glyph, .thinking-label").count(), 0);
  assert.equal(await thinking.locator(".thinking-body").evaluate((n) => getComputedStyle(n).fontStyle), "italic");
  for (const selector of [".thinking-body", ".thinking-body p", "strong", "h3", "th", "code", "code span"]) {
    const weights = await thinking.locator(selector).evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).fontWeight));
    assert.ok(weights.length > 0 && weights.every((weight) => weight === "400"), `${selector} should not be bold`);
    const styles = await thinking.locator(selector).evaluateAll(nodes => nodes.map(node => ({ color: getComputedStyle(node).color, fontStyle: getComputedStyle(node).fontStyle })));
    assert.ok(styles.every(style => style.color === "rgb(156, 163, 175)" && style.fontStyle === "italic"), `${selector} stays gray and italic`);
  }
  assert.equal(await thinking.locator("code").first().evaluate((n) => getComputedStyle(n).fontStyle), "italic");
  assert.equal(await thinking.getAttribute("data-active"), "false", "tool call ends thinking phase");
  assert.equal(await thinking.locator(".thinking-label").count(), 0);
  assert.equal(await thinking.evaluate((node) => getComputedStyle(node).borderLeftWidth), "0px");
  const live = { role: "assistant", content: [{ type: "thinking", thinking: "继续核对流式状态。" }] };
  views.messageChanged(scope, { ...chatMessage(live, "reasoning", true)!, calls: chatMessage(reasoning, "reasoning")!.calls }); views.flush(scope);
  await page.waitForFunction(() => document.querySelector('.thinking-block')?.getAttribute('data-active') === 'true');
  assert.ok(await thinking.locator(".thinking-body").isVisible(), "streaming remains directly visible");
  assert.equal(await thinking.locator(".thinking-dots span").first().evaluate((n) => getComputedStyle(n).animationName), "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  assert.equal(await thinking.locator(".thinking-dots span").first().evaluate((n) => getComputedStyle(n).animationName), "thinking-dot");
  for (const width of [375, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(artifacts, `feedback-${width}.png`) });
  }
  views.messageChanged(scope, { ...chatMessage(reasoning, "reasoning")! }); views.flush(scope);
  await page.waitForFunction(() => document.querySelector('.thinking-block')?.getAttribute('data-active') === 'false');
  assert.equal(await thinking.locator(".thinking-dots").count(), 0);
  assert.equal(await thinking.locator(".thinking-label").count(), 0);
  await page.locator(".tool-activity").screenshot({ path: join(artifacts, "thinking-direct-1440.png") });
  await page.reload(); await page.locator(".task-notice").first().waitFor({ state: "attached" });
  assert.equal(await page.locator(".task-notice").count(), 5);
  assert.deepEqual(errors, []);
  console.log(`PASS notices, thinking direct display/gray italics/dots, reduced motion, stable streaming, reload, 3 widths: ${artifacts}`);
} finally {
  await browser?.close(); await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
