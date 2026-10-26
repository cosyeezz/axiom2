// Exercise real session navigation and asynchronous layout without model calls.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-session-bottom-"));
mkdirSync(join(root, "project")); mkdirSync(join(root, "pi"));
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
const app = await startServer({ root: join(root, "data"), port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
async function settled(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function readHistory(page: Page, top: number) {
  const thread = page.locator("#thread");
  const box = (await thread.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, top - await thread.evaluate(el => el.scrollTop));
  await page.waitForFunction(top => Math.abs(document.querySelector("#thread")!.scrollTop - top) < 2, top);
  await settled(page);
}
async function atBottom(page: Page, label: string) {
  await settled(page);
  await page.waitForFunction(() => {
    const el = document.querySelector("#thread")!;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 2;
  }, null, { timeout: 5000 }).catch(async () => {
    const geometry = await page.locator("#thread").evaluate(el => ({ top: el.scrollTop, height: el.clientHeight, total: el.scrollHeight }));
    assert.fail(`${label}: ${JSON.stringify(geometry)}`);
  });
}
try {
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "project"), authorized: true } }) as Workspace;
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const sessions = ["吸底会话 A", "吸底会话 B"].map(title => {
    const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    app.store.execute({ requestId: crypto.randomUUID(), op: "session.rename", workspaceId: workspace.id, sessionId: session.id, params: { title } });
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    for (let i = 0; i < 100; i++) views.messageChanged(scope, { id: `m${i}`, role: i % 2 ? "assistant" : "user", text: `${title} 消息 ${i}\n\n用于验证切换后的最新消息位置。` });
    views.flush(scope);
    return { title, scope };
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // Unrelated concurrent edits must not reload this isolated scroll fixture.
  await page.route("**/@vite/client", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("async function handleMessage(payload) {", "async function handleMessage(payload) { return;") });
  });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(scope => sessionStorage.setItem("view", JSON.stringify(scope)), sessions[0].scope);
  await page.goto(app.origin);
  await page.getByText(`${sessions[0].title} 消息 99`, { exact: false }).waitFor();
  await atBottom(page, "initial history");
  for (const target of [sessions[1], sessions[0], sessions[1]]) {
    await readHistory(page, 0);
    await settled(page);
    await page.locator(`.history-row[data-session-id="${target.scope.sessionId}"] .history-item`).click();
    await page.getByText(`${target.title} 消息 99`, { exact: false }).waitFor();
    await atBottom(page, `switch to ${target.title}`);
  }
  // Draft growth must move visible output up, not clip its lower edge.
  const input = page.locator("#prompt");
  const viewportHeight = () => page.locator("#thread").evaluate(el => el.clientHeight);
  const viewportEnd = () => page.locator("#thread").evaluate(el => el.scrollTop + el.clientHeight);
  await input.fill("短输入");
  await settled(page);
  const shortHeight = await viewportHeight();
  await input.fill("多行输入向上增长\n".repeat(25));
  await atBottom(page, "composer growth while following");
  assert.ok(await viewportHeight() < shortHeight, "composer growth shrinks the thread viewport");
  const threadBox = (await page.locator("#thread").boundingBox())!;
  const composerBox = (await page.locator(".composer-area").boundingBox())!;
  assert.ok(threadBox.y + threadBox.height <= composerBox.y + 1, "composer stays outside the dialogue viewport");
  await page.getByRole("button", { name: "清空输入", exact: true }).click();
  await atBottom(page, "composer collapse while following");
  const maxTop = await page.locator("#thread").evaluate(el => el.scrollHeight - el.clientHeight);
  await readHistory(page, maxTop - 120);
  const readingEnd = await viewportEnd();
  await input.fill("阅读时输入增高\n".repeat(25));
  await settled(page);
  assert.ok(Math.abs(await viewportEnd() - readingEnd) < 2, "draft growth preserves the visible dialogue lower edge without jumping to tail");
  await input.fill("");
  await settled(page);
  const resume = page.getByRole("button", { name: "回到最下", exact: true });
  // Collapsing the draft may already expose the tail in the larger viewport.
  if (await resume.isEnabled()) await resume.click();
  await atBottom(page, "resume after drafting while reading");
  // Reading history must stop following later output.
  await readHistory(page, 200);
  await settled(page);
  const before = await page.locator("#thread").evaluate(el => el.scrollTop);
  views.messageChanged(sessions[1].scope, { id: "new-output", role: "assistant", text: "新增流式消息\n\n".repeat(40) });
  views.flush(sessions[1].scope);
  // Offscreen rows are intentionally unmounted while reading virtual history.
  await page.waitForFunction(async scope => {
    const path = "/transport.ts";
    return (await import(/* @vite-ignore */ path)).scopeSnapshot(`thread:${scope.workspaceId}:${scope.sessionId}`)?.ids.includes("new-output");
  }, sessions[1].scope);
  await settled(page);
  assert.equal(await page.locator("#thread").evaluate(el => el.scrollTop), before, "streaming preserves manual history position");
  // A selection elsewhere in the workbench must not block a newly opened thread.
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(".sidebar-foot")!);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
  });
  await page.locator(`.history-row[data-session-id="${sessions[0].scope.sessionId}"] .history-item`).evaluate((el: HTMLButtonElement) => el.click());
  await page.getByText(`${sessions[0].title} 消息 99`, { exact: false }).waitFor();
  await atBottom(page, "switch with an unrelated selection");
  // A selection inside this conversation still protects reading during new output.
  await page.locator("#thread .user-text").last().evaluate(el => {
    const range = document.createRange(); range.selectNodeContents(el);
    getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
  });
  assert.ok(await page.evaluate(() => getSelection()?.toString()), "fixture selects message text");
  const selectedTop = await page.locator("#thread").evaluate(el => el.scrollTop);
  views.messageChanged(sessions[0].scope, { id: "selected-output", role: "assistant", text: "选中正文时的新输出\n\n".repeat(30) });
  views.flush(sessions[0].scope);
  await page.waitForFunction(async scope => {
    const path = "/transport.ts";
    return (await import(/* @vite-ignore */ path)).scopeSnapshot(`thread:${scope.workspaceId}:${scope.sessionId}`)?.ids.includes("selected-output");
  }, sessions[0].scope);
  await settled(page);
  assert.equal(await page.locator("#thread").evaluate(el => el.scrollTop), selectedTop, "conversation selection protects scroll position");
  await page.evaluate(() => getSelection()!.removeAllRanges());
  await page.getByRole("button", { name: "回到最下", exact: true }).click();
  await atBottom(page, "resume following after selection");
  // Sending while reading history must resume following, including queued steering.
  // Use the same scoped optimistic store as useSubmission, without starting a model.
  for (const queued of [true, false]) {
    await readHistory(page, 200);
    await settled(page);
    const id = `sent-${queued}`;
    await page.evaluate(async ({ scope, id, queued }) => {
      const modulePath = "/chat/optimistic.ts";
      (await import(/* @vite-ignore */ modulePath)).optimisticStart(scope, id, { text: `本次输入 ${id}`, attachment: null }, queued);
    }, { scope: sessions[0].scope, id, queued });
    await atBottom(page, queued ? "queued steering submission" : "idle submission");
    const delivered = { id: `delivered-${id}`, role: "user" as const, text: `本次输入 ${id}`, inputIds: [id] };
    views.messageChanged(sessions[0].scope, delivered); views.flush(sessions[0].scope);
    await page.locator("#thread .user-text").filter({ hasText: delivered.text }).waitFor();
    await atBottom(page, "optimistic input reconciles with formal message");
    views.messageChanged(sessions[0].scope, { id: `reply-${id}`, role: "assistant", text: "发送后的流式输出\n\n".repeat(40) });
    views.flush(sessions[0].scope);
    await page.locator("#thread .markdown").filter({ hasText: "发送后的流式输出" }).last().waitFor();
    await atBottom(page, "streaming after submission");
  }
  // Removing the newest pending input must not treat an older pending item as a new send.
  await page.evaluate(async scope => {
    const modulePath = "/chat/optimistic.ts";
    const { optimisticStart } = await import(/* @vite-ignore */ modulePath);
    optimisticStart(scope, "older-pending", { text: "较早的待执行输入", attachment: null }, true);
    optimisticStart(scope, "newer-pending", { text: "最新待执行输入", attachment: null }, true);
  }, sessions[0].scope);
  await atBottom(page, "multiple pending inputs");
  await readHistory(page, 200);
  await settled(page);
  const pendingRemovalTop = await page.locator("#thread").evaluate(el => el.scrollTop);
  await page.evaluate(async scope => {
    const modulePath = "/chat/optimistic.ts";
    (await import(/* @vite-ignore */ modulePath)).optimisticRemove(scope, "newer-pending");
  }, sessions[0].scope);
  await settled(page);
  assert.equal(await page.locator("#thread").evaluate(el => el.scrollTop), pendingRemovalTop, "removing a pending item preserves manual reading");
  await page.getByRole("button", { name: "回到最下", exact: true }).click();
  await atBottom(page, "resume after pending removal");
  // Content can grow (e.g. a late message/image) before the previous scroll event is delivered.
  // Dispatch that event before ResizeObserver to make this ordering deterministic.
  await page.locator("#thread").evaluate(el => {
    const spacer = document.createElement("div"); spacer.style.height = "1200px";
    el.querySelector(".thread-content")!.append(spacer);
    el.dispatchEvent(new Event("scroll"));
  });
  await atBottom(page, "late layout before an earlier scroll event");
  // A short-lived tail can disappear during input reconciliation before new output grows it.
  // The browser clamps scrollTop during the shrink; its queued scroll event arrives after growth.
  await page.locator("#thread").evaluate(el => {
    const content = el.querySelector<HTMLElement>(".thread-content")!;
    const originalHeight = content.getBoundingClientRect().height;
    content.style.height = `${originalHeight - 900}px`;
    content.style.overflow = "hidden";
    void el.scrollTop; // Force the browser's automatic clamp, without any user scroll.
    content.style.height = "";
    content.style.overflow = "";
    el.dispatchEvent(new Event("scroll"));
  });
  await atBottom(page, "tail shrink and regrowth before its scroll event");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#toggle-history").click();
  await page.locator(`.history-row[data-session-id="${sessions[1].scope.sessionId}"] .history-item`).click();
  // Session B now ends in the later streamed output; message 99 is offscreen.
  await page.getByText("新增流式消息", { exact: false }).first().waitFor();
  await atBottom(page, "mobile session switch");
  assert.deepEqual(errors, []);
  console.log("PASS: initial history, cold/warm and mobile session switches, composer growth/collapse and visible reading lower edge, late-layout scroll race, manual history reading, scoped selection protection, idle/queued submission, reconciliation, post-send streaming, pending removal");
} finally {
  await browser.close(); await app.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
