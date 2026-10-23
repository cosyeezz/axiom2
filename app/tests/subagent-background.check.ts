// Real browser + six real pi workers, all using a held local SSE provider.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";
import { TaskRecords, target } from "../src/server/tasks/records.js";
import type { Workspace, Session } from "../src/shared/protocol.js";
import { until } from "./rewrite-fixture.js";

const root = mkdtempSync(join(tmpdir(), "axiom-background-ui-")), project = join(root, "project"), pi = join(root, "pi");
const artifacts = join(process.env.AXIOM_TEST_ARTIFACTS || "test-results", "background-interaction");
mkdirSync(artifacts, { recursive: true });
mkdirSync(project); mkdirSync(pi); writeFileSync(join(project, "attachment.txt"), "preserved attachment");
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = pi;
const responses: ServerResponse[] = [];
const chunk = (res: ServerResponse, content: string) => res.write(`data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`);
const provider = createServer(async (req, res) => {
  for await (const _ of req) { /* loopback only */ }
  res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders(); responses.push(res); chunk(res, "LIVE_CHILD_EVIDENCE ");
});
await new Promise<void>(r => provider.listen(0, "127.0.0.1", r));
writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: `http://127.0.0.1:${(provider.address() as any).port}/v1`, models: [{ id: "fixture", contextWindow: 64000, maxTokens: 1000 }] } } }));
writeFileSync(join(pi, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "loopback" } }));
writeFileSync(join(pi, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  app = await startServer({ root, port: 0, dev: true });
  const workspace = app.store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: project, authorized: true } }) as Workspace;
  const session = app.store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id, params: { title: "Background interaction" } }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const manager = SessionManager.create(project, join(root, "sessions"));
  manager.appendMessage({ role: "user", content: "FOREGROUND_QUESTION", timestamp: 1 });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "FOREGROUND_STABLE_ANSWER for mouse selection" }], timestamp: 2, stopReason: "stop" } as any);
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET file=excluded.file").run(session.id, manager.getSessionFile()!);
  const records = new TaskRecords(app.store), scheduler = (app.tasks as any).scheduler, views = (app.agents as any).views;
  records.freeze(scope);
  app.store.db.prepare("INSERT OR REPLACE INTO task_settings VALUES(1,?)").run(JSON.stringify({ concurrency: 6, workMs: 600000 }));
  const { taskIds } = records.create(scope, "ui-backgrounds", "local only", Array.from({ length: 6 }, (_, i) => ({ task: `child-${i}` })), { provider: "fixture", id: "fixture", thinking: "off" });
  manager.appendMessage({ role: "assistant", content: [{ type: "toolCall", id: "ui-backgrounds", name: "delegate", arguments: { context: "local only", tasks: Array.from({ length: 6 }, (_, i) => ({ task: `child-${i}` })) } }], timestamp: 3, stopReason: "toolUse" } as any);
  manager.appendMessage({ role: "toolResult", toolCallId: "ui-backgrounds", toolName: "delegate", content: [{ type: "text", text: JSON.stringify({ taskIds, status: "queued" }) }], timestamp: 4, isError: false } as any);
  scheduler.preferencesChanged();
  await until(() => responses.length === 6 && records.rows("WHERE status='running'").length === 6, "six workers not ready", 60000);
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage(), errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(value => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  const answer = page.getByText("FOREGROUND_STABLE_ANSWER for mouse selection", { exact: true }); await answer.waitFor();
  const stable = await answer.elementHandle(), input = page.locator("#prompt"), inputNode = await input.elementHandle();
  await input.fill("KEEP_UNSENT_DRAFT");
  // Replace only the native OS chooser; insertion and draft state use the real UI.
  await page.route('**/api/attachments/pick?*', route => route.fulfill({ json: { items: [{ name: "attachment.txt", path: join(project, "attachment.txt"), kind: "file" }] } }));
  await page.getByRole('button', { name: '添加附件', exact: true }).click();
  await page.waitForFunction(() => (document.querySelector('#prompt') as HTMLTextAreaElement | null)?.value.includes('[file1]'));
  const draft = await input.inputValue();
  assert.equal(await page.locator('.attachment-chip').count(), 1);
  await input.focus(); await page.keyboard.press("Control+A");
  const selection = await input.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd]);
  const stream = async (label: string) => {
    for (let i = 0; i < 5; i++) { responses.forEach(res => chunk(res, `${label}-${i} `)); await new Promise(r => setTimeout(r, 45)); }
    await page.waitForTimeout(80);
  };
  await stream("typing");
  assert.equal(await input.inputValue(), draft);
  assert.equal(await page.locator('.attachment-chip').count(), 1);
  assert.equal(await inputNode!.evaluate(node => node.isConnected && document.activeElement === node), true);
  assert.deepEqual(await input.evaluate((node: HTMLTextAreaElement) => [node.selectionStart, node.selectionEnd]), selection);
  assert.equal(await stable!.evaluate(node => node.isConnected), true);
  await answer.click({ clickCount: 3 });
  const selected = await page.evaluate(() => getSelection()?.toString()); assert.ok(selected?.includes("FOREGROUND_STABLE_ANSWER"));
  await stream("selection");
  assert.equal(await page.evaluate(() => getSelection()?.toString()), selected);
  assert.equal(await stable!.evaluate(node => node.isConnected), true);
  await page.screenshot({ path: join(artifacts, "selection.png"), fullPage: true });
  const children = taskIds.map(id => target(records.rows("WHERE id=?", id)[0]));
  await page.locator('.tool-activity > summary').click();
  for (let round = 0; round < 2; round++) for (const [index, child] of children.entries()) {
    await page.getByRole('button', { name: `打开子会话：child-${index}`, exact: true }).click();
    const window = page.getByRole('dialog', { name: '子代理会话', exact: true });
    try { await window.getByText(/LIVE_CHILD_EVIDENCE/).first().waitFor(); }
    catch (error) {
      console.error(JSON.stringify({ round, index, child, text: await window.innerText() }));
      await page.screenshot({ path: join(artifacts, 'child-failure.png') }); throw error;
    }
    responses.forEach(res => chunk(res, `window-${round} `));
    await window.getByRole('button', { name: '关闭子代理会话，返回主对话', exact: true }).click();
    await window.waitFor({ state: 'hidden' });
    assert.ok([...views.transcript(child).values()].some((message: any) => message.text.includes("LIVE_CHILD_EVIDENCE")), "closing a window retains the unpersisted stream");
  }
  assert.equal(await input.inputValue(), draft); assert.equal(await stable!.evaluate(node => node.isConnected), true);
  assert.equal(await page.locator('.attachment-chip').count(), 1);
  responses.forEach(res => res.end(`data: ${JSON.stringify({ id: "done", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`));
  await until(() => records.rows("WHERE status='completed'").length === 6, "workers did not finish");
  await until(() => children.every(child => !app!.agents.active(child)), "workers did not settle");
  await page.close(); await new Promise(r => setTimeout(r, 80));
  for (const child of children) for (const key of ["transient", "changedMessages", "timers"]) assert.equal(views[key].has(child.sessionId), false, key);
  for (const key of ["handed", "failedInputs", "nativePending", "nativeQueues", "pendingViews"]) assert.equal(scheduler[key].size, 0, key);
  assert.deepEqual(errors, []);
  console.log("PASS: six real workers; focus/selection/draft/attachment/DOM preserved; twelve child windows; durable finish and transient cleanup");
} finally {
  await browser?.close(); await app?.close(); provider.closeAllConnections(); await new Promise<void>(r => provider.close(() => r()));
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
