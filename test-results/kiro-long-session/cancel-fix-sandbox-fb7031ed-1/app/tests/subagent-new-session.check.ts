// Run from app/: npm exec tsx tests/subagent-new-session.check.ts
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type WebSocketRoute } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-subagent-new-"));
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
mkdirSync(process.env.AXIOM_PI_DIR);
writeFileSync(join(process.env.AXIOM_PI_DIR, "models.json"), JSON.stringify({ providers: {
  "new-session-fixture": { api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [{ id: "fixture", name: "New session fixture", reasoning: true }] },
} }));
writeFileSync(join(process.env.AXIOM_PI_DIR, "auth.json"), JSON.stringify({ "new-session-fixture": { type: "api_key", key: "fixture" } }));
const app = await startServer({ root: join(root, "data"), port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const context = await browser.newContext();
  await context.addInitScript((view) => sessionStorage.setItem("view", JSON.stringify(view)), { workspaceId: workspace.id, sessionId: session.id });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [], operations: string[] = [];
  let socket: WebSocketRoute | undefined, offline = false;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/status", (route) => offline ? route.fulfill({ status: 503, body: "offline" }) : route.continue());
  await page.routeWebSocket("**/ws", (route) => {
    socket = route;
    const server = route.connectToServer();
    route.onMessage((message) => {
      const request = JSON.parse(message.toString());
      operations.push(request.op);
      // An unrelated subscription error must not disable global settings on a live connection.
      if (request.op === "subscribe" && request.params.scope === "favorites") {
        route.send(JSON.stringify({ type: "receipt", requestId: request.requestId, ok: false,
          error: { code: "INVALID_SCOPE", message: "fixture favorites subscription failed" } }));
      } else server.send(message);
    });
  });
  await page.goto(app.accessUrl);
  await page.locator("#prompt").fill("未发送的草稿");
  await page.getByRole("button", { name: "子代理设置", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "子代理设置", exact: true });
  await page.waitForFunction(() => document.body.textContent?.includes("fixture favorites subscription failed"));
  const picker = dialog.locator(".model-picker > summary");
  await page.waitForFunction(() => document.querySelector('.subagent-settings .model-picker > summary')?.getAttribute('aria-disabled') !== 'true');
  await picker.click();
  await dialog.getByRole("button", { name: /^New session fixture\s*new-session-fixture$/ }).click();
  await dialog.getByRole("radio", { name: "high", exact: true }).check();
  await page.waitForFunction(() => document.querySelector('.subagent-settings .model-picker > summary')?.textContent?.includes("high"));
  assert.deepEqual(app.tasks.settings().selection, { provider: "new-session-fixture", id: "fixture", thinking: "high" });
  await dialog.getByRole("searchbox").press("Escape");
  offline = true;
  await socket!.close();
  await page.waitForFunction(() => document.querySelector('.subagent-settings .model-picker > summary')?.getAttribute('aria-disabled') === 'true');
  await picker.click();
  assert.equal(await dialog.locator(".model-popover").count(), 0, "a disconnected picker stays closed");
  offline = false;
  await page.waitForFunction(() => document.querySelector('.subagent-settings .model-picker > summary')?.getAttribute('aria-disabled') !== 'true');
  await picker.click();
  await dialog.getByRole("button", { name: "继承创建时的主会话模型", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.subagent-settings .model-picker > summary')?.textContent?.includes("继承主会话选择"));
  assert.equal(app.tasks.settings().selection, null);
  assert.equal(await page.locator("#prompt").inputValue(), "未发送的草稿");
  assert.ok(!operations.some((op) => ["prompt", "agent.start", "task.delegate"].includes(op)), "settings never require starting a conversation");
  assert.deepEqual(errors, []);
  console.log("PASS: new-session model and reasoning autosave before first send despite unrelated subscription errors; disconnect disables, reconnect restores, inheritance and draft preserved.");
} finally {
  await browser.close(); await app.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
