// Touch/mobile + dynamic visualViewport regression. No model requests or production data.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-mobile-composer-"));
const artifacts = process.env.AXIOM_MOBILE_ARTIFACTS ?? join(root, "artifacts");
for (const dir of [artifacts, join(root, "pi"), join(root, "project")]) mkdirSync(dir, { recursive: true });
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
const app = await startServer({ root: join(root, "data"), port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: join(root, "project"), authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const manager = SessionManager.create(join(root, "project"), join(root, "native"));
  const users: string[] = [];
  for (let i = 0; i < 90; i++) {
    users.push(manager.appendMessage({ role: "user", content: `手机历史问题 ${i}`, timestamp: 1 }));
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: `手机历史回答 ${i}\n\n${"稳定阅读历史，不应随输入上下闪动。".repeat(i % 4 + 1)}` }], stopReason: "stop", timestamp: 1 } as any);
  }
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(session.id, manager.getSessionFile()!);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, reducedMotion: "reduce", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1" });
  // Ignore unrelated source edits while this isolated browser measures scroll anchors.
  await context.route("**/@vite/client", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("async function handleMessage(payload) {", "async function handleMessage(payload) { return;") });
  });
  const page = await context.newPage();
  const errors: string[] = [], ops: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("websocket", ws => ws.on("framesent", ({ payload }) => { const frame = JSON.parse(String(payload)); if (frame.op) ops.push(frame.op); }));
  // tsx keepNames helpers are not serialized with Playwright's browser callbacks.
  await page.addInitScript("window.__name = (value) => value;");
  await page.addInitScript(value => sessionStorage.setItem("view", JSON.stringify(value)), scope);
  await page.goto(app.origin);
  const input = page.locator("#prompt"), thread = page.locator("#thread");
  await input.waitFor(); await page.getByText("手机历史回答 89", { exact: false }).waitFor();
  const settle = async () => { await page.waitForTimeout(200); };
  await settle();
  assert.ok(await input.evaluate(n => parseFloat(getComputedStyle(n).fontSize) >= 16), "mobile input must not trigger sub-16px iOS focus zoom");
  const supplementFont = await page.evaluate(() => {
    const probe = document.createElement("div"); probe.className = "annotation-supplement";
    probe.style.setProperty("--display-font-scale", "0.5"); probe.innerHTML = "<textarea></textarea>";
    document.body.append(probe); const size = parseFloat(getComputedStyle(probe.firstElementChild!).fontSize); probe.remove(); return size;
  });
  assert.ok(supplementFont >= 16, "annotation supplement keeps a 16px focus-zoom floor even with smaller global typography");
  // Keep single-line entry compact; expanded text owns the entire upper width.
  const geometry = () => page.locator(".composer").evaluate(form => {
    const input = form.querySelector("textarea")!, style = getComputedStyle(input);
    const rect = form.getBoundingClientRect(), text = input.getBoundingClientRect();
    const controls = [".attachment-picker", ".model-picker > summary", ".send"].map(selector => {
      const box = form.querySelector(selector)!.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height };
    });
    return { expanded: form.hasAttribute("data-multiline"), height: rect.height, width: rect.width,
      inputWidth: text.width, inputHeight: text.height, textBottom: text.bottom, scrollHeight: input.scrollHeight,
      clientHeight: input.clientHeight, lineHeight: parseFloat(style.lineHeight),
      padding: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
      bottom: rect.bottom, controls, horizontalOverflow: input.scrollWidth > input.clientWidth + 1 };
  });
  for (const android of [false, true]) {
    await page.locator(".app").evaluate((node, android) => node.classList.toggle("android-workbench", android), android);
    for (const [width, height] of [[320, 640], [390, 844], [390, 480]]) {
      await page.setViewportSize({ width, height });
      await input.fill("短"); await settle();
      const compact = await geometry();
      assert.equal(compact.expanded, false); assert.equal(compact.height, 56);
      await input.fill("第一行\n第二行"); await settle();
      const two = await geometry();
      assert.equal(two.expanded, true);
      assert.ok(two.inputWidth >= two.width - 20, "expanded text spans the full inner composer width");
      assert.ok(two.controls.every(box => box.top >= two.textBottom - 1), "controls occupy only the bottom row, never the text area");
      assert.ok(two.controls.every(box => Math.abs(box.bottom - (two.bottom - 6)) <= 1), "plus, model and send stay at the bottom");
      for (let lines = 3; lines <= 7; lines++) {
        await input.fill(Array.from({ length: lines }, (_, index) => `第${index + 1}行`).join("\n")); await settle();
        const state = await geometry();
        assert.ok(Math.abs(state.inputHeight - (Math.min(lines, 6) * state.lineHeight + state.padding)) <= 1, `mobile grows to six lines (${android ? "Android" : "iOS"}, ${width}x${height}, ${lines} lines): ${JSON.stringify(state)}`);
        assert.equal(state.horizontalOverflow, false);
        assert.equal(state.scrollHeight > state.clientHeight + 1, lines > 6, "only drafts beyond six lines scroll");
      }
      // Soft wrapping must expand once and settle, not oscillate as width changes.
      await input.fill("自动换行的长文本".repeat(12)); await settle();
      const wrapped = await geometry(); assert.equal(wrapped.expanded, true);
      await settle(); assert.deepEqual(await geometry(), wrapped);
      await input.fill(""); await settle();
      assert.equal((await geometry()).height, 56, "clearing restores the compact row");
    }
  }
  await page.locator(".app").evaluate(node => node.classList.remove("android-workbench"));
  await page.setViewportSize({ width: 390, height: 844 });
  await input.tap();
  await input.fill("多行输入与软键盘回归。".repeat(40)); await settle();
  await page.evaluate(() => {
    const w = window as any;
    w.heightWrites = []; w.frames = []; w.timelineMutations = 0; w.recordFrames = false;
    const original = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function(name, value, priority) {
      if (this === (document.querySelector("#prompt") as HTMLElement).style && name === "height") w.heightWrites.push(value);
      return original.call(this, name, value, priority);
    };
    new MutationObserver(records => { w.timelineMutations += records.length; }).observe(document.querySelector(".virtual-timeline")!, { subtree: true, childList: true, characterData: true, attributes: true });
    w.snapshot = () => {
      const n = document.querySelector<HTMLElement>("#thread")!, bounds = n.getBoundingClientRect();
      const rows = [...n.querySelectorAll<HTMLElement>("[data-timeline-key]")];
      const row = rows.find(row => row.getBoundingClientRect().bottom > bounds.top + 5);
      const visibleSpacer = [...n.querySelectorAll(".timeline-spacer")].some(node => { const r = node.getBoundingClientRect(); return Math.min(r.bottom, bounds.bottom) - Math.max(r.top, bounds.top) > 1; });
      return { key: row?.dataset.timelineKey, top: row ? row.getBoundingClientRect().top - bounds.top : 0, visibleSpacer, mounted: rows.length, bottom: n.scrollHeight - n.scrollTop - n.clientHeight, viewport: visualViewport?.height, scale: visualViewport?.scale, offsetTop: visualViewport?.offsetTop, inputHeight: document.querySelector("#prompt")!.getBoundingClientRect().height, threadHeight: bounds.height };
    };
    const tick = () => { if (w.recordFrames) w.frames.push(w.snapshot()); requestAnimationFrame(tick); }; tick();
  });
  const snapshot = () => page.evaluate(() => (window as any).snapshot());
  const following: any[] = [];
  // Visual viewport events resize the app during keyboard opening/closing.
  for (const height of [780, 680, 560, 480, 560, 680, 844]) {
    await page.setViewportSize({ width: 390, height }); await settle();
    const state = await snapshot(); following.push(state);
    assert.ok(Math.abs(state.bottom) <= 2, `keyboard viewport follows the bottom at ${height}: ${JSON.stringify(state)}`);
    assert.equal(state.visibleSpacer, false);
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--visual-height")), `${height}px`);
  }
  // A real touch gesture leaves following mode; focus and keyboard must not drag history down.
  await input.blur();
  const cdp = await context.newCDPSession(page), bounds = await thread.boundingBox(); assert.ok(bounds);
  await cdp.send("Input.synthesizeScrollGesture", { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2), yDistance: 1400, speed: 1800, gestureSourceType: "touch" });
  await settle();
  // Deterministic mid-history position after the touch intent has disabled following.
  await thread.evaluate(n => { n.scrollTop = n.scrollHeight / 2; }); await settle();
  const before = await snapshot(); assert.ok(before.bottom > 1000);
  await input.tap(); await settle();
  await page.evaluate(() => { const w = window as any; w.frames = []; w.heightWrites = []; w.timelineMutations = 0; w.recordFrames = true; });
  await input.pressSequentially("中文输入跨行和逐字编辑不再折返真实输入框高度", { delay: 20 }); await settle();
  const typing = await page.evaluate(() => ({ writes: (window as any).heightWrites, mutations: (window as any).timelineMutations }));
  assert.deepEqual(typing.writes, [], "capped multi-line typing never temporarily shrinks the real field");
  assert.equal(typing.mutations, 0, "typing a draft does not redraw the history window");
  for (const height of [780, 680, 560, 480, 560, 680, 844]) {
    await page.setViewportSize({ width: 390, height }); await settle();
    const state = await snapshot();
    assert.equal(state.key, before.key, `keyboard resize preserves reading row at ${height}`);
    assert.ok(Math.abs(state.top - before.top) <= 1, `reading anchor drift at ${height}: ${state.top - before.top}`);
  }
  const frames = await page.evaluate(() => { const w = window as any; w.recordFrames = false; return w.frames; });
  assert.ok(frames.length > 20);
  assert.ok(frames.every((s: any) => !s.visibleSpacer), "no visible spacer/blank frame during keyboard animation and typing");
  assert.ok(frames.every((s: any) => s.key === before.key && Math.abs(s.top - before.top) <= 1), "every sampled frame retains the reading anchor");
  await page.screenshot({ path: join(artifacts, "mobile-reading-keyboard.png") });
  // Edit drafts use a separate store: typing must not resubscribe/repaint the thread either.
  await page.evaluate(async ({ scope, messageId }) => {
    const path = "/chat/composer-edit.ts";
    (await import(/* @vite-ignore */ path)).startComposerEdit(scope, { messageId, revision: "fixture" }, { text: "编辑多行草稿".repeat(60), attachment: null });
  }, { scope, messageId: users[0] });
  await settle();
  const editTarget = page.locator(`[data-edit-message-id="${users[0]}"]`);
  await editTarget.waitFor(); await settle();
  const editOffset = await editTarget.evaluate(node => node.getBoundingClientRect().top - document.querySelector("#thread")!.getBoundingClientRect().top);
  assert.ok(Math.abs(editOffset - 24) <= 2, `offscreen editing target is mounted and revealed, offset=${editOffset}`);
  await page.evaluate(() => { (window as any).timelineMutations = 0; (window as any).heightWrites = []; });
  await input.pressSequentially("编辑模式逐字输入", { delay: 20 }); await settle();
  const editing = await page.evaluate(() => ({ mutations: (window as any).timelineMutations, writes: (window as any).heightWrites }));
  assert.equal(editing.mutations, 0); assert.deepEqual(editing.writes, []);
  // Deletion/collapse is intentional, but must write only the final smaller height once.
  await page.evaluate(() => { (window as any).heightWrites = []; });
  await input.fill("短"); await settle();
  assert.equal((await page.evaluate(() => (window as any).heightWrites)).length, 1);
  assert.ok(!ops.some(op => ["prompt", "agent.fork", "agent.rewrite"].includes(op)));
  assert.deepEqual(errors, []);
  const report = { passed: true, touch: true, mobile: true, dynamicVisualViewport: true, trueDeviceKeyboard: false, followingFrames: following.length, readingFrames: frames.length, maxMounted: Math.max(...frames.map((s: any) => s.mounted)), maxAnchorDrift: Math.max(...frames.map((s: any) => Math.abs(s.top - before.top))), typing, editing };
  writeFileSync(join(artifacts, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) { await page.screenshot({ path: join(artifacts, "failure.png") }); writeFileSync(join(artifacts, "failure.html"), await page.content()); }
  console.error(`Artifacts: ${artifacts}`); throw error;
} finally {
  await browser.close(); await app.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
