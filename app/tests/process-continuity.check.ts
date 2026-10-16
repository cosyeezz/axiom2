// Regression for adjacent process cards during cache reload and split-reply streaming.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import { threadScope, type ChatMessage } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-process-continuity-"));
const artifacts = resolve("test-results/process-continuity");
mkdirSync(artifacts, { recursive: true });
mkdirSync(join(root, "workspace"));
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "workspace"), authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const call = (id: string) => ({ id, name: "powershell", input: JSON.stringify({ command: "gh run view 123 --json status,conclusion,jobs" }) });
  const first: ChatMessage = { id: "first", role: "assistant", text: "", streaming: true, calls: Array.from({ length: 31 }, (_, i) => call(`call-${i}`)) };
  const reply: ChatMessage = { id: "reply", role: "assistant", text: "继续检查构建结果。", thinking: "核对流水线", streaming: true };
  views.messageChanged(scope, first);
  views.messageChanged(scope, reply);
  views.flush(scope);
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript(value => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  const card = page.locator(".tool-activity");
  await page.waitForFunction(() => document.querySelector(".activity-title")?.textContent?.includes("31 项"));
  assert.equal(await card.count(), 1);
  assert.ok(await page.locator(".reply-body").isVisible());
  await card.locator(":scope > summary").click();
  const node = await card.elementHandle();
  const split = views.thread(scope);

  // Five-session LRU eviction used to swallow the first-call layout publication.
  views.messages.delete(scope.sessionId);
  const withCalls = { ...reply, calls: [call("call-31")] };
  views.messageChanged(scope, withCalls);
  views.flush(scope);
  await page.waitForFunction(() => document.querySelector(".activity-title")?.textContent?.includes("32 项"));
  assert.equal(await card.count(), 1, "cache reload must merge the new call into the original process");
  assert.equal(await page.locator(".reply-body").count(), 0, "the body moves inside its tool message");
  assert.equal(await card.locator(".tool-call").count(), 32, "identical commands with distinct call IDs remain separate calls");
  assert.ok(await node!.evaluate(n => n.isConnected && n.hasAttribute("open")));

  // Reproduce original-view lag: a split layout can outlive the live message's first call.
  views.publish(threadScope(scope), split);
  await page.locator(".reply-body").waitFor({ state: "visible" });
  assert.equal(await card.count(), 1, "the body-only location never creates another process card");
  assert.equal(await card.locator(".tool-call").count(), 32, "the process location owns the new call exactly once");
  assert.ok(await node!.evaluate(n => n.isConnected && n.hasAttribute("open")));
  views.publish(threadScope(scope), views.thread(scope));
  await page.waitForFunction(() => document.querySelector(".reply-body") === null);

  const empty: ChatMessage = { id: "placeholder", role: "assistant", text: " \n", streaming: true };
  const next: ChatMessage = { id: "next", role: "assistant", text: "", calls: [call("call-32")], streaming: true };
  views.messageChanged(scope, empty);
  views.messageChanged(scope, next);
  views.flush(scope);
  await page.waitForFunction(() => document.querySelector(".activity-title")?.textContent?.includes("33 项"));
  assert.equal(await card.count(), 1, "invisible placeholders do not split adjacent calls");
  await card.screenshot({ path: join(artifacts, "merged-expanded.png") });
  await card.locator(":scope > summary").click();
  await card.screenshot({ path: join(artifacts, "merged-collapsed.png") });
  await page.reload();
  await page.waitForFunction(() => document.querySelector(".activity-title")?.textContent?.includes("33 项"));
  assert.equal(await card.count(), 1, "reload keeps the merged group");

  views.messageChanged(scope, { ...empty, text: "这里是独立回复正文。" });
  views.flush(scope);
  await page.locator(".reply-body").waitFor({ state: "visible" });
  assert.equal(await card.count(), 2, "real body content restores a visible boundary");
  assert.deepEqual(errors, []);
  console.log(`PASS: 31+1 calls remain one card after cache eviction, split-layout lag, empty placeholders and reload; distinct calls and real body boundaries retained. ${artifacts}`);
} finally {
  await browser?.close();
  await app?.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
  else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
