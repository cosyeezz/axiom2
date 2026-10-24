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
const app = await startServer({ root: join(root, "data"), port: 0, dev: process.env.AXIOM_TEST_PRODUCTION !== "1" });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const project = join(root, "project");
  mkdirSync(project);
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id, params: {} }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  const models = [
    { provider: "oa173", id: "astra", name: "GPT-6 Astra", levels },
    { provider: "openai-codex", id: "sol-standard", name: "GPT-6.1 Sol – Standard (Codex subscription)", levels },
    { provider: "openai-codex", id: "sol-fast", name: "GPT-6.1 Sol – Fast / Priority (Codex subscription)", levels },
    { provider: "openai-codex", id: "sol-ultrafast", name: "GPT-6.1 Sol – Ultrafast (Codex subscription; entitlement required)", levels },
    { provider: "abc", id: "opus", name: "Claude Opus 5.5", levels: ["low", "medium", "high", "xhigh", "max"] },
    ...Array.from({ length: 30 }, (_, i) => ({ provider: "fixture", id: `model-${i}`, name: `Additional model ${i}`, levels: ["off"] })),
  ];
  let selection: Selection = { provider: "oa173", id: "astra", thinking: "high" };
  const run = { id: "fixture-run", sessionId: session.id, status: "running" as const, selection: { ...selection }, startedAt: Date.now(), endedAt: null, error: null };
  let favorites: { provider: string; id: string }[] = [];
  let seq = 0;
  const requests: Command[] = [], errors: string[] = [];
  const touch = process.env.AXIOM_TEST_TOUCH === "1";
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: touch });
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
          snapshot(agentScope(scope), { ...emptyAgent, selection, run });
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
      else if (event.type === "snapshot" && event.scope === agentScope(scope)) snapshot(event.scope, { ...event.data, selection, run });
      else if (event.type === "snapshot" && event.scope === "favorites") snapshot(event.scope, favorites);
      else route.send(message);
    });
  });
  await page.addInitScript((value) => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  const picker = page.locator("#model-picker");
  const trigger = picker.locator("summary");
  // Floating menus are portalled outside <details> to escape composer clipping.
  const menu = page.locator(".model-popover[data-floating]");
  const search = menu.getByRole("searchbox");
  const confirm = menu.getByRole("button", { name: "确认模型设置" });
  const open = async () => {
    await trigger.click();
    await menu.getByRole("radio", { name: "high", exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>(".model-popover input[type=search]")?.value === "");
  };
  const committed = () => requests.filter((r) => r.op === "agent.model");
  const checkSlots = async (count: number) => {
    const layout = await menu.locator(".model-levels").evaluate(el => {
      const slots = [...el.querySelectorAll<HTMLElement>(".model-level")];
      return {
        columns: getComputedStyle(el).gridTemplateColumns.split(" ").map(Number.parseFloat),
        tops: slots.map(slot => slot.getBoundingClientRect().top),
        widths: slots.map(slot => slot.getBoundingClientRect().width),
        textFits: slots.every(slot => {
          const text = slot.querySelector("span")!;
          return text.scrollWidth <= text.clientWidth + 1;
        }),
      };
    });
    assert.equal(layout.columns.length, 7, "always reserve seven columns");
    assert.equal(layout.tops.length, count);
    assert.equal(new Set(layout.tops).size, 1, `${count} levels stay in one row`);
    assert.ok(layout.widths.every(width => Math.abs(width - layout.columns[0]) < 1), "fewer levels do not expand into reserved slots");
    assert.ok(layout.textFits, "complete reasoning labels fit their cells");
  };
  await open();
  assert.equal(await menu.locator("select").count(), 0);
  assert.equal(await menu.locator(".model-name").first().evaluate(el => parseFloat(getComputedStyle(el).fontSize)), 12);
  assert.ok(await menu.locator(".model-level span").first().evaluate(el => parseFloat(getComputedStyle(el).fontSize) <= 10));
  const runNote = menu.locator(".model-run-note");
  assert.match(await runNote.locator("summary").innerText(), /下次执行生效，本次追加不变/);
  if (touch) await runNote.locator("summary").tap();
  else await runNote.locator("summary").click();
  assert.ok(await runNote.locator("p").isVisible());
  assert.equal(await runNote.locator("p").innerText(), "当前执行：oa173 / astra · high");
  await runNote.locator("summary").click();
  assert.equal(await runNote.getAttribute("open"), null);
  await search.fill("not-a-model");
  await menu.getByRole("status").filter({ hasText: "没有匹配" }).waitFor();
  assert.equal(await menu.locator(".model-row").count(), 0);
  await search.fill("openai-codex");
  assert.equal(await menu.locator(".model-row").count(), 3);
  await menu.getByRole("button", { name: /^GPT-6.1 Sol – Ultrafast/ }).click();
  await menu.getByRole("radio", { name: "low", exact: true }).check();
  assert.equal(committed().length, 0);
  await menu.getByRole("button", { name: "取消模型设置" }).click();
  assert.equal(committed().length, 0);
  assert.ok(await trigger.evaluate((el) => document.activeElement === el));
  await open();
  assert.equal(await search.inputValue(), "");
  assert.ok(await menu.getByRole("radio", { name: "high", exact: true }).isChecked());
  await menu.getByRole("radio", { name: "high", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  assert.ok(await menu.getByRole("radio", { name: "xhigh", exact: true }).isChecked());
  await confirm.click();
  await page.waitForFunction(() => !document.querySelector("#model-picker")?.hasAttribute("open"));
  assert.equal(committed().length, 1);
  assert.equal(selection.thinking, "xhigh");
  await open();
  const row = menu.locator(".model-row").filter({ hasText: "GPT-6 Astra" });
  await row.hover();
  await row.getByRole("button", { name: "收藏模型：GPT-6 Astra", exact: true }).click();
  await row.getByRole("button", { name: "取消收藏：GPT-6 Astra", exact: true }).waitFor();
  await search.focus();
  await page.keyboard.press("Escape");
  assert.equal(await picker.getAttribute("open"), null);
  assert.ok(await trigger.evaluate((el) => document.activeElement === el));
  await open();
  const output = resolve(`test-results/model-picker-compact${touch ? "-touch" : ""}`);
  mkdirSync(output, { recursive: true });
  for (const [width, height] of [[320, 568], [360, 800], [390, 480], [390, 844], [430, 932], [600, 960], [820, 1180], [1024, 768], [1366, 768], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(() => document.querySelector(".app")?.classList.contains("mobile-workbench") === matchMedia("(max-width:640px), (pointer:coarse) and (max-height:500px)").matches);
    // Viewport emulation resolves before resize/visualViewport and ResizeObserver positioning.
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    const panel = menu;
    const box = await panel.boundingBox();
    await checkSlots(7);
    assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, `panel fits ${width}`);
    assert.ok(await panel.evaluate((el) => [el, ...el.querySelectorAll(".model-list,.model-row,.model-levels,.model-footer")].every((node) => node.scrollWidth <= node.clientWidth + 1)), `no internal overflow ${width}`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.ok(await row.evaluate((el) => el.querySelector(".model-provider-name")!.getBoundingClientRect().top >= el.querySelector(".model-name")!.getBoundingClientRect().bottom), "provider is below name");
    const list = menu.locator(".model-list");
    const listBox = await list.boundingBox();
    assert.ok(listBox && listBox.height >= (height <= 480 ? 96 : 144), `at least ${height <= 480 ? 2 : 3} visible rows at ${width}x${height}: ${listBox?.height}`);
    const footer = await menu.locator(".model-footer").boundingBox();
    assert.ok(footer && footer.y + footer.height <= box.y + box.height + 1, "actions stay visible without scrolling the panel");
    assert.ok(await menu.evaluate(el => el.scrollHeight <= el.clientHeight + 1), "only model list scrolls");
    await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await menu.getByRole("button", { name: "Additional model 29 fixture", exact: true }).waitFor({ state: "visible" });
    assert.ok(await list.evaluate(el => el.scrollTop > 0), "long directory is scrollable");
    await list.evaluate(el => { el.scrollTop = 0; });
    // The five-level state from the user's screenshot must stay on one row.
    await menu.getByRole("button", { name: /^Claude Opus 5.5/ }).click();
    await checkSlots(5);
    if (touch) {
      assert.ok(await menu.locator(".model-level, .model-actions button, .model-manage, .model-favorite, .model-search input, .model-run-note > summary").evaluateAll(els => els.every(el => el.getBoundingClientRect().height >= 44)), "touch targets retain 44px height");
      assert.ok(await menu.locator(".model-name,.model-provider-name").evaluateAll(els => els.every(el => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1)), "touch users can read full model identities without hover");
    }
    await page.screenshot({ path: join(output, `${width}x${height}.png`) });
    // Restore all seven levels for the next viewport's overflow/height checks.
    await row.locator(".model-option").click();
  }
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const scale of [1.25, 1.5]) {
      await page.evaluate(value => document.documentElement.style.setProperty("--display-font-scale", String(value)), scale);
      await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
      await checkSlots(7);
      await menu.getByRole("button", { name: /^Claude Opus 5.5/ }).click();
      await checkSlots(5);
      await row.locator(".model-option").click();
      await page.screenshot({ path: join(output, `seven-slots-${width}-${scale}.png`) });
    }
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: model picker search/empty, draft/cancel/confirm, native radio keyboard, favorites, Escape/focus, running hint, 35-model scrolling, seven reserved slots, smaller fonts, 11 viewports and 125%/150% scaling; touch=${touch}; errors=[]`);
} finally {
  await browser.close();
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
