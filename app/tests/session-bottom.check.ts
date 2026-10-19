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
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(scope => sessionStorage.setItem("view", JSON.stringify(scope)), sessions[0].scope);
  await page.goto(app.origin);
  await page.getByText(`${sessions[0].title} 消息 99`, { exact: false }).waitFor();
  await atBottom(page, "initial history");
  for (const target of [sessions[1], sessions[0], sessions[1]]) {
    await page.locator("#thread").evaluate(el => { el.scrollTop = 0; });
    await settled(page);
    await page.locator(`.history-row[data-session-id="${target.scope.sessionId}"] .history-item`).click();
    await page.getByText(`${target.title} 消息 99`, { exact: false }).waitFor();
    await atBottom(page, `switch to ${target.title}`);
  }
  // Reading history must stop following later output.
  await page.locator("#thread").evaluate(el => { el.scrollTop = 200; });
  await settled(page);
  const before = await page.locator("#thread").evaluate(el => el.scrollTop);
  views.messageChanged(sessions[1].scope, { id: "new-output", role: "assistant", text: "新增流式消息\n\n".repeat(40) });
  views.flush(sessions[1].scope);
  await page.getByText("新增流式消息", { exact: false }).first().waitFor();
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
  await page.getByText("选中正文时的新输出", { exact: false }).first().waitFor();
  await settled(page);
  assert.equal(await page.locator("#thread").evaluate(el => el.scrollTop), selectedTop, "conversation selection protects scroll position");
  await page.evaluate(() => getSelection()!.removeAllRanges());
  await page.getByRole("button", { name: "回到最下", exact: true }).click();
  await atBottom(page, "resume following after selection");
  // Content can grow (e.g. a late message/image) before the previous scroll event is delivered.
  // Dispatch that event before ResizeObserver to make this ordering deterministic.
  await page.locator("#thread").evaluate(el => {
    const spacer = document.createElement("div"); spacer.style.height = "1200px";
    el.querySelector(".thread-content")!.append(spacer);
    el.dispatchEvent(new Event("scroll"));
  });
  await atBottom(page, "late layout before an earlier scroll event");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#toggle-history").click();
  await page.locator(`.history-row[data-session-id="${sessions[1].scope.sessionId}"] .history-item`).click();
  await page.getByText(`${sessions[1].title} 消息 99`, { exact: false }).waitFor();
  await atBottom(page, "mobile session switch");
  assert.deepEqual(errors, []);
  console.log("PASS: initial history, cold/warm and mobile session switches, late-layout scroll race, manual history reading, scoped selection protection");
} finally {
  await browser.close(); await app.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
