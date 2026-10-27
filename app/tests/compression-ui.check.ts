// Isolated entry for the shared UI helper; avoids unrelated full-workbench setup.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { checkCompressionUI } from "./compression-ui.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-compression-shared-ui-"));
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
const project = join(root, "project"), artifacts = resolve("test-results");
mkdirSync(project); mkdirSync(join(root, "pi")); mkdirSync(artifacts, { recursive: true });
const provider = createServer(async (req, res) => {
  for await (const _chunk of req) { /* Consume the loopback request. */ }
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  for (const [delta, finish_reason] of [[{ role: "assistant", content: "已保存的真实会话回复" }, null], [{}, "stop"]])
    res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ id: "usage", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })}\n\n`);
  res.end("data: [DONE]\n\n");
});
const reference = createServer((req, res) => {
  if (new URL(req.url!, "http://localhost").pathname !== "/coding-agent-v2-before-subagent-modal-v2.html") return void res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(readFileSync(resolve("../ui/coding-agent-v2-before-subagent-modal-v2.html")));
});
let app: Awaited<ReturnType<typeof startServer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await new Promise<void>(resolve => provider.listen(0, "127.0.0.1", resolve));
  await new Promise<void>(resolve => reference.listen(0, "127.0.0.1", resolve));
  writeFileSync(join(root, "pi/models.json"), JSON.stringify({ providers: { "axiom-browser-fixture": {
    api: "openai-completions", baseUrl: `http://127.0.0.1:${(provider.address() as any).port}/v1`,
    models: [{ id: "fixture", name: "Fixture", contextWindow: 32000, maxTokens: 1000 }],
  } } }));
  writeFileSync(join(root, "pi/auth.json"), JSON.stringify({ "axiom-browser-fixture": { type: "api_key", key: "loopback-only" } }));
  writeFileSync(join(root, "pi/settings.json"), JSON.stringify({ compaction: { enabled: false }, retry: { enabled: false } }));
  app = await startServer({ root, port: 0, dev: true });
  const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  await app.agents.command({ ...scope, requestId: randomUUID(), op: "agent.model", params: { selection: { provider: "axiom-browser-fixture", id: "fixture", thinking: "off" } } });
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const design = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(scope => sessionStorage.setItem("view", JSON.stringify(scope)), scope);
  await page.goto(app.origin);
  await page.waitForSelector('[data-od-id="background-compression-trigger"]:enabled');
  await design.goto(`http://127.0.0.1:${(reference.address() as any).port}/coding-agent-v2-before-subagent-modal-v2.html`);
  await checkCompressionUI(page, design, app, artifacts, [[390, 844], [1440, 900]]);
  assert.deepEqual(errors, []);
  console.log("PASS: shared compression UI helper, real request-prefix refresh, complete/cancel/reload/empty state, draft focus, prototype styles and 390/1440 layouts");
} finally {
  await browser?.close();
  await app?.close();
  provider.closeAllConnections(); reference.closeAllConnections();
  await Promise.all([new Promise<void>(resolve => provider.close(() => resolve())), new Promise<void>(resolve => reference.close(() => resolve()))]);
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
