// First nonempty commits and A→B→A must do tail work, not mount a head window
// and merely settle at the bottom later. Real UI; synthetic WS, no backend/model.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { createServer } from "vite";
import type { ChatMessage, ThreadIndex } from "../src/shared/agent.js";
import type { HistoryIndex } from "../src/shared/history.js";

const temporary = mkdtempSync(join(tmpdir(), "axiom-session-tail-window-"));
const server = await createServer({ root: resolve("."), configFile: false, cacheDir: join(temporary, "vite"),
  server: { host: "127.0.0.1", port: 0, hmr: false }, esbuild: { jsx: "automatic" } });
const reports: unknown[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
type Command = { requestId: string; op: string; sessionId?: string; params?: Record<string, any> };
const snapshot = (page: Page) => page.evaluate(() => {
  const thread = document.querySelector<HTMLElement>(".thread")!;
  return { gap: thread.scrollHeight - thread.scrollTop - thread.clientHeight,
    keys: [...thread.querySelectorAll<HTMLElement>("[data-timeline-key]")].map(node => node.dataset.timelineKey!),
    mounts: (window as any).tailMounts as { phase: string; key: string; empty: boolean }[],
    paints: (window as any).tailPaints as { phase: string; spacer: number }[] };
});
async function settled(page: Page, session: string) {
  await page.waitForFunction(session => {
    const thread = document.querySelector<HTMLElement>(".thread");
    return (window as any).tailWindow?.sessionId === session && thread?.querySelector(`[data-timeline-key="message:${session}-499"]`)
      && thread.scrollHeight - thread.scrollTop - thread.clientHeight <= 1;
  }, session, { timeout: 12000 });
  // Includes delayed catalogue validation and the row-measurement frames.
  await page.waitForTimeout(250);
}
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  for (const archivedCount of [0, 400]) {
    const page: Page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    const errors: string[] = [], commands: Command[] = [];
    let holdRefresh = false;
    const heldRefresh: { kind: string; send: () => void }[] = [], warmCache: Record<string, unknown> = {};
    const reply = (kind: string, send: () => void) => { if (holdRefresh) heldRefresh.push({ kind, send }); else send(); };
    const all = Object.fromEntries(["a", "b"].map(session => [session, Array.from({ length: 500 }, (_, i): ChatMessage => ({
      id: `${session}-${i}`, role: i % 2 ? "assistant" : "user", text: `Session ${session}, message ${i}: stable tail-window text.`,
      ...(i % 2 ? { phase: "final_answer" as const, status: "completed" as const } : {}),
    }))]));
    const groups = (messages: ChatMessage[]) => messages.map(message => ({ id: message.id, ids: [message.id], activity: false, delivery: message.role === "assistant" }));
    const messages = (session: string) => all[session].slice(archivedCount);
    const thread = (session: string): ThreadIndex => ({ ids: messages(session).map(message => message.id), groups: groups(messages(session)), contextRevision: 1, runStatus: "completed" });
    const catalogue = (session: string): HistoryIndex => ({ revision: "fixed", segments: archivedCount ? [{ id: `${session}-segment`, revision: "fixed",
      compression: { number: 1, title: "Archived prefix", before: 1000, after: 100 },
      messageIds: all[session].slice(0, archivedCount).map(message => message.id),
      groups: groups(all[session].slice(0, archivedCount)).map(group => ({ ...group, revision: "fixed", estimatedHeight: 180 })),
    }] : [] });
    await page.addInitScript(() => {
      const probe = window as any;
      probe.__name = (value: unknown) => value;
      probe.tailPhase = "cold-a"; probe.tailMounts = []; probe.tailPaints = [];
      const observe = () => new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) if (node instanceof Element) {
          const rows = [...node.querySelectorAll<HTMLElement>("[data-timeline-key]")];
          if (node.matches("[data-timeline-key]")) rows.unshift(node as HTMLElement);
          for (const row of rows) probe.tailMounts.push({ phase: probe.tailPhase, key: row.dataset.timelineKey, empty: !row.textContent });
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
      if (document.documentElement) observe(); else document.addEventListener("DOMContentLoaded", observe, { once: true });
      const paint = () => {
        const thread = document.querySelector<HTMLElement>(".thread");
        if (thread?.querySelector("[data-timeline-key]")) {
          const bounds = thread.getBoundingClientRect();
          const spacer = [...thread.querySelectorAll(".timeline-spacer")].reduce((sum, node) => {
            const rect = node.getBoundingClientRect();
            return sum + Math.max(0, Math.min(bounds.bottom, rect.bottom) - Math.max(bounds.top, rect.top));
          }, 0) / thread.clientHeight;
          probe.tailPaints.push({ phase: probe.tailPhase, spacer });
        }
        requestAnimationFrame(paint);
      };
      requestAnimationFrame(paint);
    });
    page.on("pageerror", error => errors.push(error.stack ?? error.message));
    await page.route("**/api/**", route => route.fulfill({ json: { ok: true } }));
    await page.route("**/__session_tail_window", route => route.fulfill({ contentType: "text/html",
      body: '<div id="root"></div><script type="module" src="/tests/fixtures/session-tail-window.tsx"></script>' }));
    await page.routeWebSocket("**/ws", socket => {
      let seq = 0;
      const sendSnapshot = (scope: string, data: unknown, extra = {}) => {
        const send = () => socket.send(JSON.stringify({ type: "snapshot", scope, data, streamId: "tail-window", seq: ++seq, ...extra }));
        if (scope.split(":")[2] === "a") reply(`snapshot:${scope.split(":")[0]}`, send); else send();
      };
      const receipt = (command: Command, data: unknown) => {
        const send = () => { try { socket.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: true, data })); } catch { /* page closed */ } };
        if (command.sessionId === "a" || String(command.params?.scope).split(":")[2] === "a") reply(`receipt:${command.op}`, send); else send();
      };
      socket.send(JSON.stringify({ type: "hello", streamId: "tail-window" }));
      socket.onMessage(raw => {
        const command = JSON.parse(String(raw)) as Command; commands.push(command);
        if (command.op === "subscribe") {
          const scope = command.params!.scope as string, [kind, , session] = scope.split(":");
          // Deliberately commit the catalogue first. Missing live bodies must
          // not be treated as real zero-height rows while this snapshot waits.
          if (kind === "messages") setTimeout(() => sendSnapshot(scope, messages(session), { thread: thread(session) }), 80);
          else if (kind === "thread") sendSnapshot(scope, thread(session));
          else if (kind === "agent") sendSnapshot(scope, { selection: null, run: { id: `run-${session}`, sessionId: session, status: "completed" }, environment: null, usage: null });
          else sendSnapshot(scope, null);
        }
        if (command.op === "agent.history.index") { setTimeout(() => receipt(command, catalogue(command.sessionId!)), 30); return; }
        if (command.op === "agent.history.read") {
          setTimeout(() => receipt(command, { revision: "fixed", messages: all[command.sessionId!].filter(message => message.id === command.params!.groupId) }), 100); return;
        }
        receipt(command, command.op === "costs.get" ? { rows: [] } : command.op === "input.status" ? { inputs: [] } : command.op === "agent.environment" ? null : {});
      });
    });
    const phases = [];
    try {
      await page.goto(`http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}/__session_tail_window`);
      for (const [phase, session] of [["cold-a", "a"], ["cold-b", "b"], ["warm-a", "a"]] as const) {
        if (phase === "warm-a") holdRefresh = true;
        if (phase !== "cold-a") await page.evaluate(({ phase, session }) => { (window as any).tailPhase = phase; (window as any).tailWindow.select(session); }, { phase, session });
        await settled(page, session);
        if (phase === "cold-a") await page.evaluate(() => {
          const probe = window as any;
          probe.tailCached = { message: probe.tailWindow.snapshot("message:w:a:a-499"), thread: probe.tailWindow.snapshot("thread:w:a") };
        });
        if (phase === "warm-a") {
          const cached = () => page.evaluate(() => {
            const probe = window as any;
            return { message: probe.tailWindow.snapshot("message:w:a:a-499") === probe.tailCached.message,
              thread: probe.tailWindow.snapshot("thread:w:a") === probe.tailCached.thread,
              visibleText: document.querySelector('[data-timeline-key="message:a-499"]')?.textContent?.includes("message 499") === true };
          });
          warmCache.held = heldRefresh.map(item => item.kind);
          for (const kind of ["messages", "thread", "agent"]) assert.ok(heldRefresh.some(item => item.kind === `snapshot:${kind}`), `warm return must be tested before ${kind} refresh is released`);
          const before = await snapshot(page);
          const content = await cached();
          warmCache.before = { ...content, gap: before.gap, mounted: before.keys.length };
          assert.deepEqual(content, { message: true, thread: true, visibleText: true }, "cached tail must be visible while every A refresh remains blocked");
          assert.ok(before.gap <= 1 && before.keys.length > 0 && before.keys.length <= 25, "blocked refresh cannot delay the bounded physical tail");
          const orders = () => page.evaluate(() => ["messages", "thread", "agent"].map(kind => (window as any).tailWindow.order(`${kind}:w:a`)) as number[]);
          const beforeOrders = await orders();
          holdRefresh = false;
          for (const item of heldRefresh.splice(0)) item.send();
          await page.waitForFunction(previous => ["messages", "thread", "agent"].every((kind, i) => (window as any).tailWindow.order(`${kind}:w:a`) > previous[i]), beforeOrders, { timeout: 12000 });
          warmCache.delivery = { before: beforeOrders, after: await orders() };
          await settled(page, session);
          warmCache.after = await cached();
          assert.deepEqual(warmCache.after, { message: true, thread: true, visibleText: true }, "newer equal refresh must preserve cached message/thread identity");
        }
        const state = await snapshot(page);
        const keys = [...new Set(state.mounts.filter(event => event.phase === phase).map(event => event.key))];
        const paints = state.paints.filter(event => event.phase === phase);
        const emptyMounts = state.mounts.filter(event => event.phase === phase && event.empty).length;
        phases.push({ phase, gap: state.gap, stableRows: state.keys.length, keys, paints, emptyMounts });
        // Fixed fixture rows are ~114px: 25 rows exceed viewport + overscan.
        // Keep a generous bound; the essential assertion is never mounting the head.
        assert.ok(keys.length > 0 && keys.length <= 25, `${phase}: initialization must be bounded tail work, keys=${JSON.stringify(keys)}`);
        assert.ok(keys.every(key => new RegExp(`^message:${session}-(?:47[5-9]|48\\d|49\\d)$`).test(key)), `${phase}: no non-tail rows may mount: ${JSON.stringify(keys)}`);
        assert.equal(emptyMounts, 0, `${phase}: catalogue-only rows must wait for their message snapshot before measurement`);
        assert.ok(state.gap <= 1 && state.keys.includes(`message:${session}-499`), `${phase}: latest row must be at the physical bottom`);
        assert.ok(paints.length >= 2 && paints.every(paint => paint.spacer < .05), `${phase}: visible frames must not be blank spacer: ${JSON.stringify(paints)}`);
      }
      assert.equal(commands.filter(command => command.op === "agent.history.read").length, 0, "a fully live tail must not hydrate the archived prefix");
      assert.deepEqual(errors, []);
      reports.push({ archivedCount, phases, warmCache, errors, historyReads: 0 });
      console.log(`PASS archived=${archivedCount}: ${JSON.stringify(phases.map(({ phase, stableRows, keys, paints }) => ({ phase, stableRows, uniqueMounts: keys.length, firstKey: keys[0], frames: paints.length })))}`);
    } catch (error) {
      reports.push({ archivedCount, phases, warmCache, errors, commands, state: await snapshot(page).catch(() => null) });
      throw error;
    } finally { await page.close(); }
  }
} finally {
  if (process.env.AXIOM_TAIL_WINDOW_REPORT) writeFileSync(process.env.AXIOM_TAIL_WINDOW_REPORT, JSON.stringify(reports, null, 2));
  await browser?.close(); await server.close(); rmSync(temporary, { recursive: true, force: true });
}
