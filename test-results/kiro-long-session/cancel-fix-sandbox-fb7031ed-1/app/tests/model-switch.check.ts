import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";
import type { Selection } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

// Persisted display fixtures; runtime switching is covered by model-switch.test.ts.
const root = mkdtempSync(join(tmpdir(), "axiom-switch-ui-"));
const project = join(root, "project"); mkdirSync(project);
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
mkdirSync(process.env.AXIOM_PI_DIR);
const copyId = "axiom-copy-4a210b7a-abd9-4611-be62-068b9ae2e65b";
writeFileSync(join(process.env.AXIOM_PI_DIR, "models.json"), JSON.stringify({ providers: {
  "another-provider-with-a-long-name": {
    name: "自定义供应商", api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1",
    models: [{ id: copyId, axiomRequestModelId: "gpt-6-astra", name: "GPT-6 Astra（复制）", reasoning: true }],
  },
  "same-model-other-provider": {
    name: "其他供应商", api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1",
    models: [{ id: copyId, axiomRequestModelId: "gpt-6-astra", name: "不能串用的模型名称", reasoning: true }],
  },
} }));
writeFileSync(join(process.env.AXIOM_PI_DIR, "auth.json"), JSON.stringify({
  "another-provider-with-a-long-name": { type: "api_key", key: "TEST-ONLY" },
  "same-model-other-provider": { type: "api_key", key: "TEST-ONLY" },
}));
const app = await startServer({ root: join(root, "data"), port: 0, dev: process.env.AXIOM_TEST_DEV === "1" });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const workspace = app.store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: project, authorized: true } }) as Workspace;
  const session = app.store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const manager = SessionManager.create(project, join(root, "sessions"));
  const from: Selection = { provider: "original-provider", id: "original-reasoning-model", thinking: "high" };
  const to: Selection = { provider: "another-provider-with-a-long-name", id: copyId, thinking: "low" };
  const request = (id: string, text: string) => manager.appendMessage({ role: "user", content: text, timestamp: Date.now(), axiomId: id, axiomRunId: id } as any);
  const reply = (run: string, text: string, change?: { from: Selection; to: Selection }) => manager.appendMessage({ role: "assistant", content: [{ type: "text", text }], timestamp: Date.now(), provider: to.provider, model: to.id,
    thinkingLevel: to.thinking, api: "openai-completions", stopReason: "stop", axiomId: `${run}-reply`, axiomRunId: run, axiomSelectionChange: change,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  } as any);
  request("first", "首次请求"); reply("first", "首次回复");
  request("changed", "使用新模型的请求"); reply("changed", "新模型回复", { from, to });
  request("effort", "只改变思考等级的请求"); reply("effort", "等级变更后的回复", { from: to, to: { ...to, thinking: "off" } });
  request("removed", "已移除配置的历史请求"); reply("removed", "旧配置回复", {
    from: { ...to, id: "axiom-copy-removed", thinking: "off" },
    to: { ...to, id: "axiom-model-removed", thinking: "off" },
  });
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file,selection) VALUES(?,?,?)").run(session.id, manager.getSessionFile()!, JSON.stringify(to));
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((value) => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  const notices = page.locator(".task-notice").filter({ hasText: "后续请求生效" });
  await notices.nth(2).waitFor();
  assert.equal(await notices.count(), 3);
  await page.waitForFunction(() => document.querySelector(".task-notice")?.textContent?.includes("GPT-6 Astra（复制）"));
  assert.match(await notices.nth(0).innerText(), /original-provider \/ original-reasoning-model → 自定义供应商 \/ GPT-6 Astra（复制）/);
  assert.doesNotMatch(await notices.allInnerTexts().then(text => text.join("\n")), /axiom-copy-|不能串用的模型名称/);
  assert.match(await notices.nth(0).innerText(), /思考等级：high → low/);
  assert.match(await notices.nth(1).innerText(), /思考等级：low → none/);
  assert.match(await notices.nth(2).innerText(), /自定义供应商 \/ 未知模型配置 → 自定义供应商 \/ 未知模型配置/);
  assert.ok(await notices.nth(0).evaluate((node) => node.nextElementSibling?.textContent?.includes("使用新模型的请求")));
  assert.ok(await notices.nth(1).evaluate((node) => node.nextElementSibling?.textContent?.includes("只改变思考等级的请求")));
  await page.locator("#prompt").fill("未发送草稿保持不变");
  app.agents.refresh(scope);
  assert.equal(await page.locator("#prompt").inputValue(), "未发送草稿保持不变");
  await page.reload(); await notices.nth(2).waitFor();
  assert.equal(await notices.count(), 3);
  await page.waitForFunction(() => document.querySelector(".task-notice")?.textContent?.includes("GPT-6 Astra（复制）"));
  assert.match(await notices.nth(1).innerText(), /模型：自定义供应商 \/ GPT-6 Astra（复制）；思考等级：low → none/);
  assert.doesNotMatch(await notices.allInnerTexts().then(text => text.join("\n")), /axiom-(copy|model)-/);
  mkdirSync(resolve("test-results/model-switch"), { recursive: true });
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator("#thread").evaluate((node) => node.scrollTo({ top: 0, behavior: "instant" }));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.ok(await notices.evaluateAll((nodes) => nodes.every((node) => node.scrollWidth <= node.clientWidth + 1)));
    await page.screenshot({ path: resolve(`test-results/model-switch/${width}.png`) });
  }
  assert.deepEqual(errors, []);
  console.log("PASS: readable provider/copied model names, exact provider+id lookup, unknown model fallback, effort text, request placement, history reload, draft isolation, 390/820/1440 widths");
} finally {
  await browser.close(); await app.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
