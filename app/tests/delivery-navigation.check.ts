// Real sessions and virtual history; isolated data, no model requests.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
import type { AgentViews } from "../src/server/agents/views.js";

const root = mkdtempSync(join(tmpdir(), "axiom-delivery-nav-"));
const artifacts = process.env.AXIOM_NAV_ARTIFACTS ?? join(root, "artifacts");
for (const path of [artifacts, join(root, "pi"), join(root, "project")]) mkdirSync(path, { recursive: true });
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
const app = await startServer({ root: join(root, "data"), port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "project"), authorized: true } }) as Workspace;
  const create = () => app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const session = create(), empty = create(), compact = create(), plain = create();
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const manager = SessionManager.create(join(root, "project"), join(root, "native"));
  const assistant = (text: string, phase: "commentary" | "final_answer" = "final_answer") => manager.appendMessage({ role: "assistant", content: [{ type: "text", text, textSignature: JSON.stringify({ v: 1, id: "fixture", phase }) }], stopReason: "stop", timestamp: 1 } as any);
  const paragraphs = (title: string, count = 30) => title + "\n\n" + Array.from({ length: count }, (_, i) => `阅读段落 ${i}：逐次跳到该方向的交付起点，保留当前阅读位置。`).join("\n\n");
  const archived: string[] = [], live: string[] = [], users: string[] = [];
  for (let i = 0; i < 16; i++) {
    manager.appendMessage({ role: "user", content: `归档问题 ${i}`, timestamp: 1 });
    archived.push(assistant(paragraphs(`归档交付 ${i}`)));
  }
  const compaction = manager.appendCompaction("## 历史压缩信息", null, 24000);
  for (let i = 0; i < 65; i++) {
    users.push(manager.appendMessage({ role: "user", content: i ? `当前问题 ${i}` : paragraphs("首条长问题，使第一处交付未挂载", 100), timestamp: 1 }));
    assistant(`说明 ${i}：这不是交付。`, "commentary");
    live.push(assistant(paragraphs(`当前交付 ${i}`)));
  }
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(session.id, manager.getSessionFile()!);
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const shortIds = Array.from({ length: 20 }, (_, i) => `short-${i}`);
  for (const id of shortIds) {
    views.messageChanged({ ...scope, sessionId: compact.id }, { id: `user-${id}`, role: "user", text: "短问题" });
    views.messageChanged({ ...scope, sessionId: compact.id }, { id, role: "assistant", phase: "final_answer", status: "completed", text: "短交付" });
  }
  views.flush({ ...scope, sessionId: compact.id });
  views.messageChanged({ ...scope, sessionId: plain.id }, { id: "only-user", role: "user", text: paragraphs("没有交付也能回到首尾", 100) });
  views.flush({ ...scope, sessionId: plain.id });
  const errors: string[] = [], ops: string[] = [];
  let legacyFrames = 0;
  const prepare = async (page: Page, target = scope, legacy = false) => {
    page.setDefaultTimeout(12000);
    await page.addInitScript("window.__name = value => value;");
    await page.addInitScript(({ value, compaction }) => {
      sessionStorage.setItem("view", JSON.stringify(value)); localStorage.setItem("axiom.mobile.reading", "false");
      sessionStorage.setItem(`axiom:history-ranges:${value.workspaceId}:${value.sessionId}`, JSON.stringify({ [compaction]: false }));
    }, { value: target, compaction });
    await page.route("**/@vite/client", async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace("async function handleMessage(payload) {", "async function handleMessage(payload) { return;") });
    });
    if (legacy) await page.routeWebSocket("**/ws", route => {
      const server = route.connectToServer();
      server.onMessage(raw => {
        const frame = JSON.parse(raw.toString());
        const thread = frame.scope?.startsWith("thread:") ? frame.data : frame.thread;
        if (thread?.groups) { thread.groups.forEach((group: { delivery?: boolean }) => { delete group.delivery; }); legacyFrames++; }
        route.send(JSON.stringify(frame));
      });
    });
    page.on("pageerror", error => errors.push(error.message));
    page.on("websocket", ws => ws.on("framesent", ({ payload }) => { const frame = JSON.parse(String(payload)); if (frame.op) ops.push(frame.op); }));
  };
  const arrow = (page: Page, direction: "up" | "down") => page.locator(`.thread-navigation [data-scroll=${direction}]`);
  const settle = async (page: Page) => { await page.waitForTimeout(120); };
  const manual = async (page: Page, destination: "top" | "bottom" | number) => {
    await page.locator("#thread").dispatchEvent("wheel", { deltaY: -1 });
    await page.locator("#thread").evaluate((node, destination) => { node.scrollTop = destination === "top" ? 0 : destination === "bottom" ? node.scrollHeight : node.scrollTop + destination; }, destination);
    await settle(page);
  };
  const positioned = async (page: Page, id: string) => {
    const check = () => page.waitForFunction(id => {
      const body = document.querySelector<HTMLElement>(`[data-delivery-start="${id}"]`), thread = document.querySelector("#thread");
      if (!body || !thread) return false;
      const wanted = thread.scrollTop + body.getBoundingClientRect().top - thread.getBoundingClientRect().top - 24;
      return Math.abs(thread.scrollTop - Math.max(0, Math.min(wanted, thread.scrollHeight - thread.clientHeight))) < 2;
    }, id);
    await check(); await settle(page); await check();
    assert.ok(await page.locator("[data-timeline-key]").count() < 45, "navigation preserves windowing");
  };
  const edge = async (page: Page, direction: "up" | "down") => {
    await arrow(page, direction).click();
    await page.waitForFunction(direction => { const n = document.querySelector("#thread")!; return direction === "up" ? n.scrollTop < 2 : n.scrollHeight - n.scrollTop - n.clientHeight < 2; }, direction);
    await settle(page);
  };
  const jump = async (page: Page, direction: "up" | "down", id: string) => { await arrow(page, direction).click(); await positioned(page, id); };
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
  await prepare(page); await page.goto(app.origin);
  await page.locator(`[data-delivery-start="${live.at(-1)}"]`).waitFor();
  assert.equal(await page.locator(".thread-navigation button:visible").count(), 4);
  assert.deepEqual(await page.locator(".thread-navigation button").evaluateAll(buttons => buttons.map(button => ({
    target: button.getAttribute("data-scroll"), path: button.querySelector("path")?.getAttribute("d"), viewBox: button.querySelector("svg")?.getAttribute("viewBox"),
  }))), [
    { target: "top", path: "M7 5h10M7 14l5-5 5 5M12 9v11", viewBox: "6 4 12 17" },
    { target: "up", path: "m6 15 6-6 6 6", viewBox: "5 8 14 8" },
    { target: "down", path: "m6 9 6 6 6-6", viewBox: "5 8 14 8" },
    { target: "bottom", path: "M7 19h10M7 10l5 5 5-5M12 4v11", viewBox: "6 3 12 17" },
  ], "desktop keeps the original four icons and their order");
  assert.equal(await page.locator('[data-scroll="delivery"],.thread-navigation-label').count(), 0);
  await page.getByRole("button", { name: "回到最上", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#thread")!.scrollTop < 2);
  await page.getByRole("button", { name: "回到最下", exact: true }).click();
  await page.waitForFunction(() => { const node = document.querySelector("#thread")!; return node.scrollHeight - node.clientHeight - node.scrollTop < 2; });
  await page.locator("#prompt").fill("导航不能提交或丢失这份草稿");
  await manual(page, "top");
  assert.equal(await page.locator(`[data-delivery-start="${live[0]}"]`).count(), 0, "first destination is outside the mounted window");
  await jump(page, "down", live[0]); await jump(page, "down", live[1]); await jump(page, "up", live[0]); await edge(page, "up");
  await arrow(page, "down").evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  await positioned(page, live[1]); // Rapid clicks use the intended cursor before the first reveal has mounted.
  await page.evaluate(async ({ scope, id }) => {
    const path = "/chat/composer-edit.ts";
    const { startComposerEdit } = await import(/* @vite-ignore */ path);
    startComposerEdit(scope, { messageId: id, revision: "fixture" }, { text: "独立的修改草稿" });
  }, { scope, id: users[0] });
  await page.getByRole("button", { name: "取消修改", exact: true }).waitFor(); await settle(page);
  await jump(page, "down", live[0]);
  const beforeManual = await page.locator("#thread").evaluate(node => node.scrollTop);
  await manual(page, 100);
  assert.ok(Math.abs(await page.locator("#thread").evaluate(node => node.scrollTop) - beforeManual - 100) < 2,
    "cancelling delivery navigation must not revive an old editor reveal");
  await page.getByRole("button", { name: "取消修改", exact: true }).click();
  assert.equal(await page.locator("#prompt").inputValue(), "导航不能提交或丢失这份草稿");
  await page.locator("#thread").dispatchEvent("wheel", { deltaY: -1 });
  await page.locator("#thread").evaluate(node => { node.scrollTop = node.scrollHeight * .45; }); await settle(page);
  const currentId = await page.evaluate(() => {
    const thread = document.querySelector<HTMLElement>("#thread")!, bounds = thread.getBoundingClientRect();
    const body = [...thread.querySelectorAll<HTMLElement>("[data-delivery-start]")].find(body => body.getBoundingClientRect().bottom > bounds.top + 400)!;
    thread.scrollTop += body.getBoundingClientRect().top - bounds.top + 500;
    return body.dataset.deliveryStart!;
  });
  await settle(page); assert.notEqual(currentId, live[0]); assert.notEqual(currentId, live.at(-1));
  await jump(page, "up", currentId);
  await jump(page, "down", live[live.indexOf(currentId) + 1]); await jump(page, "up", currentId);
  views.messageChanged(scope, { id: "new-arrival", role: "assistant", phase: "final_answer", text: paragraphs("新交付到达"), status: "completed" }); views.flush(scope);
  await positioned(page, currentId);
  assert.equal(await page.locator("#prompt").inputValue(), "导航不能提交或丢失这份草稿");
  await manual(page, "top");
  for (const id of [...live, "new-arrival"]) await jump(page, "down", id);
  await edge(page, "down");
  await jump(page, "up", "new-arrival");
  for (const id of [...live].reverse()) await jump(page, "up", id);
  await edge(page, "up");
  assert.equal(await page.locator(`[data-compaction-id="${compaction}"]`).getByRole("button", { name: "展开会话原文", exact: true }).isVisible(), true, "stepping never expands collapsed archives");
  await page.locator(`[data-compaction-id="${compaction}"]`).getByRole("button", { name: "展开会话原文", exact: true }).click(); await settle(page);
  for (const id of archived) await jump(page, "down", id);
  await jump(page, "down", live[0]); await jump(page, "up", archived.at(-1)!);
  await page.screenshot({ path: join(artifacts, "desktop.png") });

  // Short answers near the physical bottom must still be stepped through in order.
  const short = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
  await prepare(short, { ...scope, sessionId: compact.id }); await short.goto(app.origin);
  await short.locator('[data-delivery-start="short-19"]').waitFor(); await manual(short, "top");
  for (const id of shortIds) await jump(short, "down", id);
  await edge(short, "down");
  await manual(short, "top"); await jump(short, "down", shortIds[0]);
  for (const id of shortIds.slice(1)) await jump(short, "down", id);
  for (const id of shortIds.slice(0, -1).reverse()) await jump(short, "up", id);
  await edge(short, "up");

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  const phone = await mobile.newPage(); await prepare(phone, scope, true); await phone.goto(app.origin);
  await phone.locator("#prompt").fill("手机草稿");
  assert.equal(await phone.locator(".thread-navigation").isVisible(), false, "ordinary conversation starts without a floating arrow");
  await phone.locator('[data-delivery-start="new-arrival"]').waitFor();
  await phone.locator("#thread .reply-body").last().dispatchEvent("pointerdown", { pointerType: "touch" });
  // Simulate a layout/clamp displacement after a plain tap, not a scroll gesture.
  await phone.locator("#thread").evaluate(node => { node.scrollTop -= 40; }); await settle(phone);
  assert.equal(await phone.locator(".thread-navigation").isVisible(), false, "plain taps plus layout scrolling do not reveal an arrow");
  const geometry = async (page: Page, reading: boolean) => {
    const state = await page.evaluate(reading => {
      const thread = document.querySelector("#thread")!.getBoundingClientRect();
      const buttons = [...document.querySelectorAll<HTMLElement>(".thread-navigation button")].filter(node => node.getClientRects().length && getComputedStyle(node).display !== "none").map(node => node.getBoundingClientRect());
      const expand = document.querySelector(".mobile-expand")?.getBoundingClientRect();
      const composer = document.querySelector<HTMLElement>(".composer-area");
      const composerTop = composer && getComputedStyle(composer).display !== "none" ? composer.getBoundingClientRect().top : Infinity;
      const shell = document.querySelector(".thread-shell")!.getBoundingClientRect();
      const contentStyle = getComputedStyle(document.querySelector(".thread-content")!);
      return { visible: buttons.length, fits: buttons.every(rect => rect.width >= 44 && rect.height >= 44 && rect.left >= 0 && rect.right <= innerWidth && rect.top >= thread.top && rect.bottom <= thread.bottom && rect.bottom <= composerTop),
        centered: buttons.every(rect => Math.abs(rect.left + rect.width / 2 - shell.left - shell.width / 2) < 1),
        edgePositioned: buttons.every(rect => document.querySelector(".thread-navigation")!.getAttribute("data-direction") === "up"
          ? Math.abs(rect.top - shell.top - 12) < 1 : Math.abs(shell.bottom - rect.bottom - 12) < 1),
        overlay: getComputedStyle(document.querySelector(".thread-navigation")!).position === "absolute",
        noGutter: contentStyle.paddingLeft === "16px" && contentStyle.paddingRight === "16px" && Math.abs(thread.width - shell.width) < 1,
        noExpandOverlap: !reading || !expand || buttons.every(rect => rect.right <= expand.left || rect.left >= expand.right || rect.bottom <= expand.top || rect.top >= expand.bottom), overflow: document.documentElement.scrollWidth > innerWidth + 1, threadHeight: thread.height };
    }, reading);
    assert.deepEqual(state, { visible: 1, fits: true, centered: true, edgePositioned: true, overlay: true, noGutter: true, noExpandOverlap: true, overflow: false, threadHeight: state.threadHeight });
    assert.ok(state.threadHeight > 30);
  };
  for (const [width, height] of [[320, 720], [390, 844], [390, 480], [390, 320], [844, 390]]) {
    await phone.setViewportSize({ width, height }); await settle(phone);
    await manual(phone, "top"); await geometry(phone, false);
    assert.equal(await arrow(phone, "up").isVisible(), true); assert.equal(await arrow(phone, "down").isVisible(), false);
    await phone.screenshot({ path: join(artifacts, `${width}x${height}-up.png`) });
    await manual(phone, 100); await geometry(phone, false);
    assert.equal(await arrow(phone, "down").isVisible(), true); assert.equal(await arrow(phone, "up").isVisible(), false);
    await phone.screenshot({ path: join(artifacts, `${width}x${height}-down.png`) });
    await jump(phone, "down", live[0]); await manual(phone, 100);
    assert.equal(await arrow(phone, "down").isVisible(), true); await jump(phone, "down", live[1]);
    await manual(phone, -100); assert.equal(await arrow(phone, "up").isVisible(), true); await jump(phone, "up", live[0]);
    await phone.screenshot({ path: join(artifacts, `${width}x${height}-expanded.png`) });
    await phone.getByRole("button", { name: "收起工作台，只看对话", exact: true }).click(); await settle(phone);
    await manual(phone, "top"); await geometry(phone, true);
    await manual(phone, 100); await jump(phone, "down", live[0]); await jump(phone, "down", live[1]);
    await geometry(phone, true);
    await phone.screenshot({ path: join(artifacts, `${width}x${height}-reading.png`) });
    await phone.getByRole("button", { name: "展开工作台", exact: true }).click();
    assert.equal(await phone.locator("#prompt").inputValue(), "手机草稿");
  }
  await phone.waitForTimeout(2150);
  assert.equal(await phone.locator(".thread-navigation").isVisible(), false, "arrows disappear again when scrolling and stepping stop");
  await phone.screenshot({ path: join(artifacts, "mobile-idle-hidden.png") });
  assert.ok(legacyFrames > 0, "mobile fallback was exercised with group.delivery removed from wire snapshots");
  const native = await mobile.newPage(); await prepare(native);
  await native.goto(app.origin + "/#axiom-native=1"); await native.locator(".app.reading-mode").waitFor();
  await native.locator('[data-delivery-start="new-arrival"]').waitFor();
  for (const [width, height] of [[390, 844], [844, 390], [800, 1280]]) {
    await native.setViewportSize({ width, height }); await settle(native);
    await manual(native, "top"); await geometry(native, true);
    await manual(native, 100); await jump(native, "down", live[0]); await jump(native, "down", live[1]);
    await geometry(native, true);
    await native.screenshot({ path: join(artifacts, `${width}x${height}-android-reading.png`) });
  }
  await native.getByRole("button", { name: "展开工作台", exact: true }).click();
  await native.setViewportSize({ width: 390, height: 320 });
  await native.locator("#prompt").fill("原生短屏长草稿\n".repeat(30)); await settle(native);
  await manual(native, "top"); await geometry(native, false);
  await manual(native, 100); await jump(native, "down", live[0]); await geometry(native, false);
  await native.screenshot({ path: join(artifacts, "android-short-draft.png") });
  const noAnswer = await browser.newPage({ reducedMotion: "reduce" }); await prepare(noAnswer, { ...scope, sessionId: plain.id }); await noAnswer.goto(app.origin);
  await noAnswer.locator(".user-text").waitFor(); await edge(noAnswer, "up"); await edge(noAnswer, "down");
  const blank = await browser.newPage(); await prepare(blank, { ...scope, sessionId: empty.id }); await blank.goto(app.origin);
  await blank.getByRole("heading", { name: "从一个想法，一行代码开始。", exact: true }).waitFor();
  assert.equal(await arrow(blank, "up").isDisabled(), true); assert.equal(await arrow(blank, "down").isDisabled(), true);
  assert.equal(ops.includes("prompt"), false); assert.deepEqual(errors, []);
  console.log("PASS delivery-navigation", JSON.stringify({ artifacts, currentId, liveDeliveries: live.length + 1, archivedDeliveries: archived.length, shortDeliveries: shortIds.length, mobileViewports: 5, legacyFrames, errors }));
} catch (error) {
  for (const [i, page] of browser.contexts().flatMap(context => context.pages()).entries()) {
    await page.screenshot({ path: join(artifacts, `failure-${i}.png`) }).catch(() => {});
    writeFileSync(join(artifacts, `failure-${i}.html`), await page.content());
    writeFileSync(join(artifacts, `failure-${i}.json`), JSON.stringify(await page.evaluate(() => {
      const thread = document.querySelector("#thread");
      return { top: thread?.scrollTop, height: thread?.clientHeight, total: thread?.scrollHeight,
        bodies: [...document.querySelectorAll<HTMLElement>("[data-delivery-start]")].map(node => ({ id: node.dataset.deliveryStart, top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom })),
        nav: document.querySelector(".thread-navigation")?.outerHTML, threadTop: thread?.getBoundingClientRect().top };
    }), null, 2));
  }
  console.error(`Artifacts: ${artifacts}`); throw error;
} finally {
  await browser.close(); await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  if (!process.env.AXIOM_NAV_KEEP_ROOT) rmSync(root, { recursive: true, force: true });
}
