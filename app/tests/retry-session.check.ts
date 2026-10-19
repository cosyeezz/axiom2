import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Session, Scope, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-retry-ui-")), project = join(root, "project");
mkdirSync(project); mkdirSync(join(root, "pi"));
const oldPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
let mode = "auth", count = 0;
const fixture = createServer(async (req, res) => {
  for await (const _ of req) { /* drain */ }
  count++;
  if (mode === "auth" || mode === "retry" && count === 1) {
    res.writeHead(mode === "auth" ? 401 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: mode === "auth" ? "invalid api key fixture" : "503 service unavailable" } })); return;
  }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const [delta, finish_reason] of [[{ role: "assistant", content: "continued successfully" }, null], [{}, "stop"]])
    res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  res.end("data: [DONE]\n\n");
});
await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
writeFileSync(join(root, "pi", "models.json"), JSON.stringify({ providers: { "ui-retry-fixture": { api: "openai-completions", baseUrl: `http://127.0.0.1:${(fixture.address() as any).port}/v1`, models: [{ id: "fixture", name: "Fixture", contextWindow: 32000, maxTokens: 1000 }] } } }));
writeFileSync(join(root, "pi", "auth.json"), JSON.stringify({ "ui-retry-fixture": { type: "api_key", key: "local-fixture" } }));
writeFileSync(join(root, "pi", "settings.json"), JSON.stringify({ retry: { enabled: true, maxRetries: 1, baseDelayMs: 3000, provider: { maxRetries: 0 } }, compaction: { enabled: false }, cacheWarming: "off" }));
const app = await startServer({ root, port: 0, dev: process.env.AXIOM_TEST_PRODUCTION !== "1" });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync) });
const until = async (check: () => boolean, message: string) => {
  const end = Date.now() + 20000;
  while (!check()) { if (Date.now() > end) throw Error(message); await new Promise((resolve) => setTimeout(resolve, 20)); }
};
try {
  const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const create = (title: string): Scope => {
    const session = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    app.store.execute({ requestId: randomUUID(), op: "session.rename", workspaceId: workspace.id, sessionId: session.id, params: { title } });
    return { workspaceId: workspace.id, sessionId: session.id };
  };
  const viewed = create("当前会话"), target = create("运行与未读并存");
  const call = (scope: Scope, op: string, params: Record<string, unknown>) => app.tasks.command({ requestId: randomUUID(), op, ...scope, params });
  for (const scope of [viewed, target]) await call(scope, "agent.model", { selection: { provider: "ui-retry-fixture", id: "fixture", thinking: "off" } });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  let heldResume: { request: any; send: () => void; reject: (code: string) => void } | undefined;
  let resumeCommands = 0, resumeQueryStatus = "uncertain";
  await page.routeWebSocket(/\/ws/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((raw) => {
      const request = JSON.parse(String(raw));
      if (request.op === "agent.resume") {
        resumeCommands++;
        heldResume = { request, send: () => server.send(raw), reject: (code) => socket.send(JSON.stringify({
          type: "receipt", requestId: request.requestId, ok: false,
          error: { code, message: code === "UNCERTAIN" ? "fixture uncertain" : "重试未受理测试" },
        })) };
      } else if (request.op === "request.get" && request.params?.requestId === heldResume?.request.requestId) {
        socket.send(JSON.stringify({ type: "receipt", requestId: request.requestId, ok: true,
          data: { status: resumeQueryStatus, data: { message: "重试未受理测试" } } }));
      } else server.send(raw);
    });
    server.onMessage((raw) => socket.send(raw));
  });
  await page.addInitScript((scope) => sessionStorage.setItem("view", JSON.stringify(scope)), viewed);
  await page.goto(app.origin);
  await page.locator("#prompt").waitFor({ timeout: 10000 }).catch(async (error) => {
    throw Error(`${error.message}\nPage errors: ${JSON.stringify(errors)}\n${await page.locator("body").innerText()}`);
  });
  await page.locator("#prompt").fill("保留正在编辑的草稿");
  // A real failed execution creates the reading watermark and the recovery action.
  await page.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'))");
  await call(viewed, "prompt", { text: "failure fixture" });
  await until(() => !app.agents.active(viewed), "failure did not settle");
  await page.getByRole("button", { name: "重试", exact: true }).waitFor();
  const retryButton = page.getByRole("button", { name: "重试", exact: true });
  assert.equal(await retryButton.innerText(), "", "retry is an icon, not a text button");
  assert.equal(await retryButton.locator("svg").count(), 1);
  mkdirSync("../artifacts", { recursive: true });
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const retryBox = await retryButton.boundingBox();
    const sendBox = await page.getByRole("button", { name: "发送消息", exact: true }).boundingBox();
    assert.ok(retryBox && sendBox && retryBox.width === 44 && retryBox.height === 44);
    assert.ok(retryBox.y + retryBox.height <= sendBox.y, "retry belongs above the composer");
    assert.equal(await page.locator('#messages > .thread-tail-actions:last-child .retry-action').count(), 1);
    assert.equal(await page.locator('.composer .retry-action').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `../artifacts/retry-icon-${width}.png` });
  }
  assert.equal(app.store.session(workspace.id, viewed.sessionId).unread, true);
  assert.equal(await page.locator(`[data-session-id="${viewed.sessionId}"] .session-state.unread`).count(), 0, "opened session hides blue indicator even before its read receipt");
  await page.evaluate("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});document.dispatchEvent(new Event('visibilitychange'))");
  await until(() => !app.store.session(workspace.id, viewed.sessionId).unread, "visible committed context wasn't acknowledged");
  // Hold the request before it reaches the server: the click itself must remove the action.
  const removedSynchronously = await retryButton.evaluate((node) => {
    (node as HTMLButtonElement).click();
    (node as HTMLButtonElement).click();
    return !node.isConnected;
  });
  assert.equal(removedSynchronously, true);
  await until(() => !!heldResume, "resume wasn't sent");
  assert.equal(resumeCommands, 1, "rapid clicks cannot duplicate the command");
  await page.waitForTimeout(400);
  assert.equal(await retryButton.count(), 0, "waiting for admission stays silent");
  await page.locator(`[data-session-id="${target.sessionId}"] button.history-item`).click();
  await page.waitForFunction(() => document.querySelector('#chat-title')?.textContent === '运行与未读并存');
  await page.locator(`[data-session-id="${viewed.sessionId}"] button.history-item`).click();
  await page.waitForFunction(() => document.querySelector('#chat-title')?.textContent === '当前会话');
  assert.equal(await retryButton.count(), 0, "navigation cannot restore an in-flight retry");
  heldResume!.reject("UNCERTAIN");
  await page.waitForTimeout(300);
  assert.equal(await retryButton.count(), 0);
  assert.doesNotMatch(await page.locator('.composer-foot').innerText(), /fixture uncertain|结果待确认|正在读取/);
  assert.equal(await page.getByRole('button', { name: '发送消息', exact: true }).isEnabled(), true, "unknown retry cannot indefinitely block new input");
  resumeQueryStatus = "failed";
  await retryButton.waitFor({ timeout: 12000 });
  assert.match(await page.locator('.composer-foot').innerText(), /重试未受理测试/);
  assert.equal(await page.locator('#prompt').inputValue(), '保留正在编辑的草稿');
  mode = "success"; count = 0;
  heldResume = undefined;
  await retryButton.focus();
  await page.keyboard.press("Enter");
  assert.equal(await retryButton.count(), 0, "keyboard retry disappears before admission");
  assert.equal(await page.locator('#prompt').evaluate((node) => document.activeElement === node), true);
  await until(() => !!heldResume, "second resume wasn't sent");
  heldResume!.send();
  await until(() => app.agents.info(viewed).run?.status === "completed", "continue did not complete");
  assert.equal(await page.locator("#prompt").inputValue(), "保留正在编辑的草稿");
  assert.equal(app.agents.messages(viewed).filter((message) => message?.role === "user").length, 1);
  assert.equal(count, 1);
  // Keyboard retry focuses the composer; dismiss its tooltip before testing other overlays.
  await page.keyboard.press("Escape");
  await page.locator('.axiom-tooltip').waitFor({ state: 'hidden' });

  // Neither an overlay nor viewing the start of a long transcript confirms its end.
  await page.evaluate("const cover=document.createElement('div');cover.id='reading-cover';cover.style.cssText='position:fixed;inset:0;z-index:99999;background:black';document.body.append(cover)");
  app.store.recordResult(viewed.sessionId, "covered-result", "run"); app.agents.refresh(viewed);
  await page.waitForTimeout(1200);
  assert.equal(app.store.session(workspace.id, viewed.sessionId).unread, true, "covered thread is not read");
  await page.evaluate("document.getElementById('reading-cover').remove()");
  await until(() => !app.store.session(workspace.id, viewed.sessionId).unread, "uncovered result wasn't acknowledged").catch(async (error) => {
    console.error("READ_DIAGNOSTICS", await page.evaluate(() => {
      const thread = document.querySelector('#thread')!;
      const rect = thread.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, Math.min(rect.bottom - 4, innerHeight - 1));
      return { focus: document.hasFocus(), visibility: document.visibilityState, title: document.querySelector('#chat-title')?.textContent,
        threads: document.querySelectorAll('#thread').length, active: document.activeElement?.outerHTML,
        top: thread.scrollTop, height: thread.clientHeight, scrollHeight: thread.scrollHeight,
        hit: hit?.outerHTML.slice(0, 300), contains: !!hit && thread.contains(hit) };
    }));
    throw error;
  });
  await page.locator("#thread .thread-content").evaluate((el) => { (el as HTMLElement).style.minHeight = "2400px"; });
  await page.waitForTimeout(100);
  await page.locator("#thread").evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll", { bubbles: true })); });
  app.store.recordResult(viewed.sessionId, "below-fold-result", "run"); app.agents.refresh(viewed);
  await page.waitForTimeout(1200);
  assert.equal(app.store.session(workspace.id, viewed.sessionId).unread, true, "scrolling old content cannot acknowledge newer results");
  await page.locator("#thread").evaluate((el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event("scroll", { bubbles: true })); });
  await until(() => !app.store.session(workspace.id, viewed.sessionId).unread, "bottom result wasn't acknowledged");
  await page.locator("#thread .thread-content").evaluate((el) => { (el as HTMLElement).style.minHeight = ""; });

  mode = "retry"; count = 0;
  await call(target, "prompt", { text: "retry fixture" });
  await until(() => app.agents.info(target).run?.retry?.state === "waiting", "no retry state");
  app.store.recordResult(target.sessionId, "background-result", "run");
  app.agents.refresh(target);
  const targetRow = page.locator(`[data-session-id="${target.sessionId}"]`);
  await targetRow.locator('[aria-label="运行中"]').waitFor();
  assert.equal(await targetRow.locator('[aria-label="未读"]').count(), 0);
  assert.match(await targetRow.innerText(), /等待重试/);
  assert.equal(app.store.session(workspace.id, target.sessionId).unread, true);
  assert.match(await targetRow.locator("svg.session-state").getAttribute("data-tooltip") ?? "", /未读结果/);
  mkdirSync("../artifacts", { recursive: true });
  await page.screenshot({ path: "../artifacts/retry-session-running.png" });
  await until(() => !app.agents.active(target), "retry did not complete");
  await targetRow.locator('[aria-label="未读"]').waitFor();
  await targetRow.locator("button.history-item").click();
  await targetRow.locator('.session-state.unread').waitFor({ state: 'detached' });
  await until(() => !app.store.session(workspace.id, target.sessionId).unread, "opened result wasn't read");
  // Remaining child work keeps the sidebar active without an execution footer.
  const child = create("子任务");
  app.store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,role,status,budgets,createdAt) VALUES('active-child',?,?,?,'a','fixture','','running','{}',1)")
    .run(workspace.id, target.sessionId, child.sessionId);
  app.store.recordResult(target.sessionId, "another-result", "run"); app.agents.refresh(target);
  await targetRow.locator('[aria-label="运行中"]').waitFor();
  assert.match(await targetRow.innerText(), /子任务活动中/);
  assert.equal(await page.locator('#messages > [role="status"]').count(), 0);
  assert.equal(await page.getByRole("button", { name: "重试", exact: true }).count(), 0);
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  assert.deepEqual(errors, []);
  console.log("PASS: retry activity wins unread; only visible uncovered bottom results acknowledge; SVG retry resumes without new input and preserves draft; remaining child work stays active in the sidebar; 390/820/1440 fit");
} finally {
  await browser.close(); await app.close(); fixture.closeAllConnections(); await new Promise<void>((resolve) => fixture.close(() => resolve()));
  if (oldPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = oldPi;
  rmSync(root, { recursive: true, force: true });
}
