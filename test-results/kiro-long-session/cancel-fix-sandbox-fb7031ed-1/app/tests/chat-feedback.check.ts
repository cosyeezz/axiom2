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
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS ?? "test-results/chat-feedback");
mkdirSync(artifacts, { recursive: true }); mkdirSync(join(root, "pi"));
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const w = app.store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: root, authorized: true } }) as Workspace;
  const s = app.store.execute({ op: "session.create", requestId: crypto.randomUUID(), workspaceId: w.id }) as Session;
  const scope = { workspaceId: w.id, sessionId: s.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  for (const status of ["completed", "cancelled", "failed", "interrupted", "unknown"]) {
    const projected = chatMessage({ role: "custom", customType: "axiom-result", display: true, content: JSON.stringify({ taskId: "secret-task", runId: "secret-run", resultId: "secret-result", status }) }, status);
    assert.equal(projected, null);
    // A client with a cached legacy projection must hide it too.
    views.messageChanged(scope, { id: status, role: "notice", text: "子代理已完成", taskNotice: status === "unknown" ? "unknown" : status as "completed", resultId: "secret-result" });
  }
  const reasoning = { role: "assistant", content: [{ type: "thinking", thinking: "先检查**消息的展示边界**，再保留内部数据。\n\n### 检查标题\n\n| 检查项 |\n| --- |\n| 字重 |\n\n`const ready = true`\n\n```js\nconst ready = true;\n```" }, { type: "toolCall", id: "read", name: "read", arguments: { path: "src/server/transcript.ts" } }] };
  views.messageChanged(scope, chatMessage(reasoning, "reasoning", true)!);
  views.messageChanged(scope, { id: "tool-read", role: "toolResult", text: "done", status: "completed" });
  views.flush(scope);
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await page.route('**/@vite/client', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('async function handleMessage(payload) {', 'async function handleMessage(payload) { return;') });
  });
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((value) => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  await page.locator(".tool-activity > summary").waitFor();
  assert.equal(await page.locator(".task-notice, .task-notices").count(), 0);
  assert.ok(!(await page.locator("#messages").innerText()).includes("secret-"));
  await page.locator(".tool-activity > summary").click();
  const thinking = page.locator(".thinking-block");
  await thinking.locator('.thinking-header').click();
  await thinking.locator(".thinking-body").waitFor({ state: "visible" });
  assert.ok(await thinking.locator(".thinking-body").isVisible(), "thinking remains accessible through its disclosure");
  assert.equal(await thinking.locator(".thinking-glyph").count(), 0);
  assert.equal(await thinking.locator(".thinking-body").evaluate((n) => getComputedStyle(n).fontStyle), "italic");
  for (const selector of [".thinking-body", ".thinking-body p", "strong", "h3", "th", "code", "code span"]) {
    const weights = await thinking.locator(selector).evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).fontWeight));
    assert.ok(weights.length > 0 && weights.every((weight) => weight === "400"), `${selector} should not be bold`);
    const styles = await thinking.locator(selector).evaluateAll(nodes => nodes.map(node => ({ color: getComputedStyle(node).color, fontStyle: getComputedStyle(node).fontStyle })));
    assert.ok(styles.every(style => style.color === "rgb(230, 216, 163)" && style.fontStyle === "italic"), `${selector} keeps the current thinking color and italic style`);
  }
  assert.equal(await thinking.locator("code").first().evaluate((n) => getComputedStyle(n).fontStyle), "italic");
  assert.equal(await thinking.getAttribute("data-status"), "completed", "tool call ends thinking phase");
  assert.equal(await thinking.locator(".thinking-label .process-ellipsis").count(), 0);
  assert.equal(await thinking.evaluate((node) => getComputedStyle(node).borderLeftWidth), "0px");
  const live = { role: "assistant", content: [{ type: "thinking", thinking: "继续核对流式状态。" }] };
  views.messageChanged(scope, { ...chatMessage(live, "reasoning", true)!, calls: chatMessage(reasoning, "reasoning")!.calls }); views.flush(scope);
  await page.waitForFunction(() => document.querySelector('.thinking-block')?.getAttribute('data-status') === 'running');
  assert.ok(await thinking.locator(".thinking-body").isVisible(), "streaming preserves the expanded thought");
  assert.equal(await thinking.locator('.process-ellipsis circle').count(), 3);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  for (const width of [375, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(artifacts, `feedback-${width}.png`) });
  }
  views.messageChanged(scope, { ...chatMessage(reasoning, "reasoning")! }); views.flush(scope);
  await page.waitForFunction(() => document.querySelector('.thinking-block')?.getAttribute('data-status') === 'completed');
  assert.equal(await thinking.locator(".process-ellipsis").count(), 0);
  assert.equal(await thinking.locator(".thinking-label").count(), 1);
  await page.locator(".tool-activity").screenshot({ path: join(artifacts, "thinking-direct-1440.png") });
  await page.reload(); await page.locator(".tool-activity > summary").waitFor();
  assert.equal(await page.locator(".task-notice, .task-notices").count(), 0);
  assert.deepEqual(errors, []);
  console.log(`PASS hidden internal/legacy notifications, current thinking disclosure/italics/streaming, reload, 3 widths: ${artifacts}`);
} finally {
  await browser?.close(); await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
