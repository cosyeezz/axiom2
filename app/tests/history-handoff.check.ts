// Real AgentThread + Composer: live/archive handoff and lazy delivery ownership.
// Fully mocked transport. Never starts a backend or sends a model request.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { createServer } from "vite";
import type { ChatMessage } from "../src/shared/agent.js";
import type { HistoryIndex } from "../src/shared/history.js";

const temporary = mkdtempSync(join(tmpdir(), "axiom-history-handoff-"));
const server = await createServer({ root: resolve("."), configFile: false, cacheDir: join(temporary, "vite"),
  server: { host: "127.0.0.1", port: 0, hmr: false }, esbuild: { jsx: "automatic" } });
const selected = process.env.AXIOM_HANDOFF_CASE ?? "all";
const reports: unknown[] = [];
const long = (id: string) => Array.from({ length: 80 }, (_, i) => `${id} paragraph ${i}: keep this completed delivery visible while archive ownership changes.`).join("\n\n");
const message = (id: string, text = id, delivery = false): ChatMessage => ({ id, role: delivery ? "assistant" : "user", text,
  ...(delivery ? { phase: "final_answer" as const, status: "completed" as const } : {}) });
const archived = [message("question"), message("first", long("FIRST"), true), message("second", long("SECOND"), true)];
const tail = [message("latest-question"), message("latest", long("LATEST"), true)];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const errors: string[] = [];
async function fixture(page: Page, initiallyArchived: boolean) {
  let socket: any, seq = 0, promoted = initiallyArchived;
  let held = true;
  const pending: any[] = [], commands: any[] = [];
  const groups = (messages: ChatMessage[]) => messages.map(m => ({ id: m.id, ids: [m.id], activity: false, delivery: m.role === "assistant" }));
  const index = (): HistoryIndex => ({ revision: promoted ? "archive" : "live", segments: promoted ? [{ id: "segment", revision: "g1",
    compression: { number: 1, title: "Archived prefix", before: 10000, after: 1000 }, messageIds: archived.map(m => m.id),
    groups: archived.map(m => ({ ...groups([m])[0], revision: "g1", estimatedHeight: m.role === "assistant" ? 5000 : 180 })) }] : [] });
  const messages = () => promoted ? tail : [...archived, ...tail];
  const thread = () => ({ ids: messages().map(m => m.id), groups: groups(messages()), contextRevision: promoted ? "archive" : "live", runStatus: "completed" });
  const receipt = (c: any, data: unknown) => socket.send(JSON.stringify({ type: "receipt", requestId: c.requestId, ok: true, data }));
  const snapshot = (s: string, data: unknown, extra = {}) => socket.send(JSON.stringify({ type: "snapshot", scope: s, streamId: "handoff", seq: ++seq, data, ...extra }));
  const body = (c: any) => ({ revision: index().revision, messages: archived.filter(m => m.id === c.params.groupId) });
  await page.addInitScript("window.__name = value => value;");
  page.on("pageerror", e => errors.push(e.stack ?? e.message));
  await page.route("**/api/**", route => route.fulfill({ json: { ok: true } }));
  await page.route("**/__handoff", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div><style>html,body,#root{margin:0;height:100%}.thread-navigation{opacity:1!important;pointer-events:auto!important}</style><script type="module" src="/tests/fixtures/history-handoff.tsx"></script>' }));
  await page.routeWebSocket("**", ws => ws.send(JSON.stringify({ type: "connected" })));
  await page.routeWebSocket("**/ws", ws => {
    socket = ws;
    ws.onMessage(raw => {
      const c = JSON.parse(String(raw)); commands.push(c);
      if (c.op === "subscribe") {
        const s = c.params.scope;
        if (s === "messages:w:s") snapshot(s, messages(), { thread: thread() });
        else if (s === "thread:w:s") snapshot(s, thread());
        else if (s === "agent:w:s") snapshot(s, { selection: null, run: { id: "r", sessionId: "s", status: "completed" }, environment: null, usage: null });
        else snapshot(s, null);
      }
      if (c.op === "agent.history.index") {
        if (promoted && !initiallyArchived) setTimeout(() => receipt(c, index()), 180);
        else receipt(c, index());
        return;
      }
      if (c.op === "agent.history.read") { if (held) pending.push(c); else receipt(c, body(c)); return; }
      receipt(c, c.op === "agent.environment" ? null : c.op === "input.status" ? { inputs: [] } : c.op === "costs.get" ? { rows: [] } : {});
    });
  });
  await page.goto(`http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}/__handoff`);
  await page.locator('[data-delivery-start="latest"]').waitFor({ state: "attached", timeout: 12000 }).catch(async error => {
    console.error("fixture failed", errors, commands, await page.locator("body").innerText()); throw error;
  });
  await page.waitForTimeout(250);
  return {
    promote() { promoted = true; snapshot("messages:w:s", messages(), { thread: thread() }); },
    release() { held = false; for (const c of pending.splice(0)) receipt(c, body(c)); },
    commands,
  };
}
const state = (page: Page, id: string) => page.evaluate(id => {
  const t = document.querySelector<HTMLElement>(".thread")!, b = t.querySelector<HTMLElement>(`[data-delivery-start="${id}"]`);
  const composer = document.querySelector<HTMLElement>(".workspace>.composer-area")!;
  return { top: t.scrollTop, total: t.scrollHeight, height: t.clientHeight, gap: t.scrollHeight - t.scrollTop - t.clientHeight,
    body: b ? { top: b.getBoundingClientRect().top - t.getBoundingClientRect().top, height: b.getBoundingClientRect().height,
      key: b.closest<HTMLElement>("[data-timeline-key]")!.dataset.timelineKey } : null,
    threadBottom: t.getBoundingClientRect().bottom, composerTop: composer.getBoundingClientRect().top };
}, id);
try {
  await server.listen(); browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  if (selected === "all" || selected === "handoff") {
  const page = await browser.newPage({ viewport: { width: 694, height: 1700 } });
  const live = await fixture(page, false);
  await page.locator('.thread-navigation [data-scroll="top"]').click(); await page.waitForTimeout(1200);
  await page.locator('.thread-navigation [data-scroll="down"]').click(); await page.waitForTimeout(300);
  await page.evaluate(() => {
    const t = document.querySelector<HTMLElement>(".thread")!, b = t.querySelector<HTMLElement>('[data-delivery-start="first"]')!;
    t.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, bubbles: true }));
    t.scrollTop += b.getBoundingClientRect().top - t.getBoundingClientRect().top + 900;
  });
  await page.waitForTimeout(150);
  const before = await state(page, "first"); assert.ok(before.body && before.body.height > 3000 && before.body.top < -800);
  await page.evaluate(() => {
    (window as any).handoffFrames = []; (window as any).sampleHandoff = true;
    const sample = () => {
      const t = document.querySelector<HTMLElement>(".thread")!, b = t.querySelector<HTMLElement>('[data-delivery-start="first"]');
      (window as any).handoffFrames.push(b ? { top: b.getBoundingClientRect().top - t.getBoundingClientRect().top, height: b.getBoundingClientRect().height } : null);
      if ((window as any).sampleHandoff) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  live.promote(); await page.waitForTimeout(300);
  const pending = await state(page, "first");
  assert.ok(live.commands.some(c => c.op === "agent.history.read" && c.params.groupId === "first"), "archive validation must still be requested");
  assert.ok(pending.body && pending.body.height >= before.body.height - 1, `handoff must not replace a tall displayed body by loading: ${JSON.stringify({ before, pending })}`);
  assert.ok(Math.abs(pending.body.top - before.body.top) <= 1, `handoff must preserve the reading offset: ${JSON.stringify({ before, pending })}`);
  live.release(); await page.waitForTimeout(350);
  const after = await state(page, "first");
  assert.ok(after.body && Math.abs(after.body.top - before.body.top) <= 1, "validated archive must retain the reading offset");
  const frames: ({ top: number; height: number } | null)[] = await page.evaluate(() => { (window as any).sampleHandoff = false; return (window as any).handoffFrames; });
  assert.ok(frames.length > 10 && frames.every(frame => frame && Math.abs(frame.top - before.body!.top) <= 1 && frame.height >= before.body!.height - 1), `handoff must retain every sampled frame, not just recover later: ${JSON.stringify(frames)}`);
  reports.push({ case: "handoff", before, pending, after, frames });
  await page.locator('.thread-navigation [data-scroll="bottom"]').click(); await page.waitForTimeout(1300);
  const bottom = await state(page, "latest");
  assert.ok(bottom.gap <= 1 && bottom.threadBottom <= bottom.composerTop + 1, `true bottom must remain above the real composer: ${JSON.stringify(bottom)}`);
  console.log("PASS live/archive handoff: long body and negative reading offset preserved; validation still read; final bottom unobscured");
  assert.ok(!live.commands.some(c => ["prompt", "append", "stop"].includes(c.op)));
  await page.close();
  }

  if (selected === "all" || selected === "lazy") {
  const lazyPage = await browser.newPage({ viewport: { width: 694, height: 1700 } });
  const lazy = await fixture(lazyPage, true);
  // First align the currently live delivery; previous then targets the archive.
  await lazyPage.locator('.thread-navigation [data-scroll="up"]').click(); await lazyPage.waitForTimeout(200);
  await lazyPage.locator('.thread-navigation [data-scroll="up"]').click();
  await lazyPage.waitForFunction(() => !!document.querySelector(".history-loading"));
  await lazyPage.locator(".thread").evaluate(t => { t.scrollTop -= 120; t.dispatchEvent(new Event("scroll")); });
  await lazyPage.waitForTimeout(100); lazy.release();
  await lazyPage.locator('[data-delivery-start="second"]').waitFor({ state: "attached" });
  await lazyPage.waitForTimeout(500);
  const revealed = await state(lazyPage, "second");
  assert.ok(revealed.body && Math.abs(revealed.body.top - 24) <= 1, `layout scroll must not cancel a delivery waiting for its body: ${JSON.stringify(revealed)}`);
  reports.push({ case: "lazy", revealed });
  console.log("PASS lazy previous delivery: layout clamp does not cancel its target; body arrives at the 24px reading inset");
  assert.ok(!lazy.commands.some(c => ["prompt", "append", "stop"].includes(c.op)));
  await lazyPage.close();
  }

  if (selected === "all" || selected === "edge") {
    const page = await browser.newPage({ viewport: { width: 694, height: 700 } });
    page.on("pageerror", e => errors.push(e.stack ?? e.message));
    await page.addInitScript("window.__name = value => value;");
    await page.route("**/__pending_edge", route => route.fulfill({ contentType: "text/html", body: '<div id="root"></div><style>body{margin:0}</style><script type="module" src="/tests/fixtures/edge-pending.tsx"></script>' }));
    await page.goto(`http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}/__pending_edge`);
    await page.waitForFunction(() => !!(window as any).pendingEdge);
    await page.evaluate(() => (window as any).pendingEdge.start());
    await page.waitForTimeout(1500);
    const loading = await page.evaluate(() => (window as any).pendingEdge.snapshot());
    assert.ok(loading.active && loading.gap <= 1, `stable loading placeholder must not finish edge ownership: ${JSON.stringify(loading)}`);
    const cdp = await page.context().newCDPSession(page), images: string[] = [];
    cdp.on("Page.screencastFrame", event => { images.push(event.data); void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }); });
    await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
    await page.evaluate(() => (window as any).pendingEdge.resolve());
    await page.waitForFunction(() => !(window as any).pendingEdge.snapshot().active);
    await page.waitForTimeout(100); await cdp.send("Page.stopScreencast");
    const resolved = await page.evaluate(() => (window as any).pendingEdge.snapshot());
    assert.ok(resolved.gap <= 1 && resolved.mounted < 40, `arriving long body must finish at true bottom with bounded rows: ${JSON.stringify(resolved)}`);
    const painted = await page.evaluate(async images => {
      const canvas = document.createElement("canvas"), context = canvas.getContext("2d")!, result: number[] = [];
      for (const data of images) {
        const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
        canvas.width = image.width; canvas.height = image.height; context.drawImage(image, 0, 0);
        const pixels = context.getImageData(300, 2, 1, 596).data;
        let green = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 136 && pixels[i + 1] === 204 && pixels[i + 2] === 136) green++;
        result.push(green / 596);
      }
      return result;
    }, images);
    assert.ok(painted.length > 0 && painted.every(coverage => coverage > .99), `lazy body arrival must paint body rather than spacer: ${JSON.stringify(painted)}`);
    reports.push({ case: "edge", loading, resolved, painted });
    console.log(`PASS pending edge: holds ownership beyond placeholder stability; tall body arrives at true bottom; ${painted.length} CDP frames have >99% body coverage`);
    await cdp.detach(); await page.close();
  }
  assert.deepEqual(errors, []);
} finally {
  if (process.env.AXIOM_HANDOFF_REPORT) writeFileSync(process.env.AXIOM_HANDOFF_REPORT, JSON.stringify(reports, null, 2));
  await browser?.close(); await server.close(); rmSync(temporary, { recursive: true, force: true });
}
