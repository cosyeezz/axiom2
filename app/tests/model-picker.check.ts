import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Command, Session, Workspace } from "../src/shared/protocol.js";
import { agentScope, emptyAgent, type Selection } from "../src/shared/agent.js";

// UI-only model directory and receipts; never contacts a remote model provider.
const root = mkdtempSync(join(tmpdir(), "axiom-model-picker-"));
const app = await startServer({ root: join(root, "data"), port: 0 });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const project = join(root, "project");
  mkdirSync(project);
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id, params: {} }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const levels = ["minimal", "low", "medium", "high", "xhigh", "max"];
  const models = [
    { provider: "oa173", id: "astra", name: "GPT-6 Astra", levels },
    { provider: "openai-codex", id: "sol-standard", name: "GPT-6.1 Sol – Standard (Codex subscription)", levels },
    { provider: "openai-codex", id: "sol-fast", name: "GPT-6.1 Sol – Fast / Priority (Codex subscription)", levels },
    { provider: "openai-codex", id: "sol-ultrafast", name: "GPT-6.1 Sol – Ultrafast (Codex subscription; entitlement required)", levels },
    { provider: "abc", id: "opus", name: "Claude Opus 5", levels: ["off", "low", "high"] },
  ];
  let selection: Selection = { provider: "oa173", id: "astra", thinking: "high" };
  let favorites: { provider: string; id: string }[] = [];
  let seq = 0;
  const requests: Command[] = [], errors: string[] = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.routeWebSocket("**/ws", (route) => {
    const server = route.connectToServer();
    const snapshot = (key: string, data: unknown) => route.send(JSON.stringify({ type: "snapshot", scope: key, streamId: "model-picker-fixture", seq: ++seq, data }));
    route.onMessage((message) => {
      const command = JSON.parse(message.toString()) as Command;
      if (command.op === "agent.model" || command.op === "favorites.set") {
        requests.push(command);
        if (command.op === "agent.model") {
          selection = command.params!.selection as Selection;
          snapshot(agentScope(scope), { ...emptyAgent, selection });
        } else {
          const m = command.params as { provider: string; id: string; favorite: boolean };
          favorites = favorites.filter((f) => f.provider !== m.provider || f.id !== m.id);
          if (m.favorite) favorites.push({ provider: m.provider, id: m.id });
          snapshot("favorites", favorites);
        }
        route.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: true, data: {} }));
      } else server.send(message);
    });
    server.onMessage((message) => {
      const event = JSON.parse(message.toString());
      if (event.type === "snapshot" && event.scope === "configuration") snapshot(event.scope, { ...event.data, available: models, modelCount: models.length });
      else if (event.type === "snapshot" && event.scope === agentScope(scope)) snapshot(event.scope, { ...event.data, selection });
      else if (event.type === "snapshot" && event.scope === "favorites") snapshot(event.scope, favorites);
      else route.send(message);
    });
  });
  await page.addInitScript((value) => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  const picker = page.locator("#model-picker");
  const trigger = picker.locator("summary");
  const search = picker.getByRole("searchbox");
  const confirm = picker.getByRole("button", { name: "确认模型设置" });
  const open = async () => {
    await trigger.click();
    await picker.getByRole("radio", { name: "high", exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>("#model-picker input[type=search]")?.value === "");
  };
  const committed = () => requests.filter((r) => r.op === "agent.model");
  await open();
  assert.equal(await picker.locator("select").count(), 0);
  await search.fill("not-a-model");
  await picker.getByRole("status").filter({ hasText: "没有匹配" }).waitFor();
  assert.equal(await picker.locator(".model-row").count(), 0);
  await search.fill("openai-codex");
  assert.equal(await picker.locator(".model-row").count(), 3);
  await picker.getByRole("button", { name: /^GPT-6.1 Sol – Ultrafast/ }).click();
  await picker.getByRole("radio", { name: "low", exact: true }).check();
  assert.equal(committed().length, 0);
  await picker.getByRole("button", { name: "取消模型设置" }).click();
  assert.equal(committed().length, 0);
  assert.ok(await trigger.evaluate((el) => document.activeElement === el));
  await open();
  assert.equal(await search.inputValue(), "");
  assert.ok(await picker.getByRole("radio", { name: "high", exact: true }).isChecked());
  await picker.getByRole("radio", { name: "high", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.ok(await picker.getByRole("radio", { name: "xhigh", exact: true }).isChecked());
  await confirm.click();
  await page.waitForFunction(() => !document.querySelector("#model-picker")?.hasAttribute("open"));
  assert.equal(committed().length, 1);
  assert.equal(selection.thinking, "xhigh");
  await open();
  const row = picker.locator(".model-row").filter({ hasText: "GPT-6 Astra" });
  await row.hover();
  await row.getByRole("button", { name: "收藏模型：GPT-6 Astra", exact: true }).click();
  await row.getByRole("button", { name: "取消收藏：GPT-6 Astra", exact: true }).waitFor();
  await search.focus();
  await page.keyboard.press("Escape");
  assert.equal(await picker.getAttribute("open"), null);
  assert.ok(await trigger.evaluate((el) => document.activeElement === el));
  await open();
  mkdirSync(resolve("test-results"), { recursive: true });
  for (const [width, height] of [[360, 800], [390, 844], [430, 932], [600, 960], [820, 1180], [1024, 768], [1366, 768], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    const panel = picker.locator(".model-popover");
    const box = await panel.boundingBox();
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, `panel fits ${width}`);
    assert.ok(await panel.evaluate((el) => [el, ...el.querySelectorAll(".model-list,.model-row,.model-levels,.model-footer")].every((node) => node.scrollWidth <= node.clientWidth + 1)), `no internal overflow ${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.ok(await row.evaluate((el) => el.querySelector(".model-provider-name")!.getBoundingClientRect().top >= el.querySelector(".model-name")!.getBoundingClientRect().bottom), "provider is below name");
    await page.screenshot({ path: resolve(`test-results/model-picker-${width}.png`) });
  }
  assert.deepEqual(errors, []);
  console.log("PASS: model picker search/empty, draft/cancel/confirm, native radio keyboard, favorites, Escape/focus and nine responsive screenshots");
} finally {
  await browser.close();
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
