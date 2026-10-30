// Real Workbench/History, synthetic WS only; no backend, SDK, models or personal data.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { createServer } from "vite";
import { World, session } from "./fixtures/session-selection-world.js";

const temporary = mkdtempSync(join(tmpdir(), "axiom-history-scroll-vite-"));
const artifacts = process.env.AXIOM_HISTORY_SCROLL_ARTIFACTS ?? mkdtempSync(join(tmpdir(), "axiom-history-scroll-evidence-"));
mkdirSync(artifacts, { recursive: true });
const vite = await createServer({ root: resolve("."), configFile: false, cacheDir: join(temporary, "cache"),
  server: { host: "127.0.0.1", port: 0, hmr: false }, esbuild: { jsx: "automatic" } });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const reports: unknown[] = [];
const group = (page: Page, top = false) => page.getByRole("region", { name: top ? "置顶会话" : "当前空间对话", exact: true });
const rows = (page: Page, top = false) => group(page, top).locator(".history-row[data-session-id]:not([hidden])");
const row = (page: Page, id: string) => page.locator(`#history .history-row[data-session-id="${id}"]`);
const numbers = (prefix: string, count = 65) => Array.from({ length: count }, (_, i) => `${prefix}${String(i).padStart(2, "0")}`);
const ids = (page: Page, top = false) => rows(page, top).evaluateAll(elements => elements.map(el => (el as HTMLElement).dataset.sessionId));
const countOps = (world: World, op: string) => world.commands.filter(c => c.op === op).length;
const settle = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
async function until(check: () => unknown, message: string) {
  const deadline = Date.now() + 5000;
  while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(check(), message);
}
async function waitRows(page: Page, count: number, top = false) {
  await page.waitForFunction(({ count, top }) => document.querySelectorAll(`#history section[aria-label="${top ? "置顶会话" : "当前空间对话"}"] .history-row[data-session-id]:not([hidden])`).length === count,
    { count, top }, { timeout: 5000 }); await settle(page);
}
async function scrollTail(page: Page, top = false) {
  await group(page, top).locator("[data-history-tail]").evaluate(tail => {
    const root = document.getElementById("history")!;
    root.scrollTop += tail.getBoundingClientRect().top - root.getBoundingClientRect().bottom + 80;
    root.dispatchEvent(new Event("scroll"));
  }); await settle(page);
}
async function visible(page: Page) {
  return page.locator("#history").evaluate(root => {
    const bounds = root.getBoundingClientRect();
    return [...root.querySelectorAll<HTMLElement>(".history-row[data-session-id]:not([hidden])")]
      .filter(row => { const box = row.getBoundingClientRect(); return box.bottom > bounds.top && box.top < bounds.bottom; })
      .map(row => ({ id: row.dataset.sessionId!, workspaceId: row.dataset.workspaceId!, offset: row.getBoundingClientRect().top - bounds.top }));
  });
}
async function anchor(page: Page) { const [first] = await visible(page); assert(first); return first; }
async function assertAnchor(page: Page, before: Awaited<ReturnType<typeof anchor>>) {
  await settle(page);
  const offset = await row(page, before.id).evaluate(element => element.getBoundingClientRect().top - document.getElementById("history")!.getBoundingClientRect().top);
  assert.ok(Math.abs(offset - before.offset) <= 2, `anchor ${before.id} moved ${offset - before.offset}px`);
}
function populate(world: World, cold = false) {
  world.add(session("viewer"));
  for (let i = 0; i < 65; ++i) {
    const id = String(i).padStart(2, "0");
    const top = world.add(session(`t-${id}`, i === 0 ? "foreign" : "w", { pinned: true, title: `Top ${id}`, updatedAt: 2000 - i, messageCount: cold ? undefined : 2 }), true);
    world.pinned.push(top);
    world.add(session(`n-${id}`, "w", { title: `Ordinary ${id}`, updatedAt: 1000 - i, messageCount: cold ? undefined : 2 }), true);
  }
}
const cases: { name: string; run(world: World, facts: Record<string, unknown>): Promise<void> }[] = [
  { name: "automatic-append-error-anchor", run: async (world, facts) => {
    populate(world); await world.ready(); await waitRows(world.page, 30, true); await waitRows(world.page, 30);
    assert.equal(await world.page.locator("#history .history-page-controls").count(), 0);
    assert.equal(await world.page.locator("#history").getByRole("button", { name: /上一页|下一页/ }).count(), 0);
    world.holdPages.add("top"); await scrollTail(world.page, true);
    await until(() => world.pending("session-list.page", "top").length, "top tail automatically starts a read");
    const held = world.pending("session-list.page", "top")[0];
    const saved = await anchor(world.page), element = await row(world.page, saved.id).elementHandle();
    const calls = countOps(world, "session-list.page");
    for (let i = 0; i < 3; ++i) await world.page.locator("#history").evaluate(root => root.dispatchEvent(new Event("scroll")));
    await world.page.waitForTimeout(80); assert.equal(countOps(world, "session-list.page"), calls, "one in-flight page per group");
    assert.deepEqual(await ids(world.page, true), numbers("t-", 30));
    world.holdPages.delete("top"); world.answer(held); await waitRows(world.page, 60, true);
    await assertAnchor(world.page, saved);
    assert.equal(await row(world.page, saved.id).evaluate((node, old) => node === old, element), true);
    await scrollTail(world.page, true); await waitRows(world.page, 65, true);
    world.holdPages.add("workspace"); await scrollTail(world.page);
    await until(() => world.pending("session-list.page", "workspace").length, "ordinary tail starts its own read");
    world.answer(world.pending("session-list.page", "workspace")[0], "PAGE_UNAVAILABLE");
    await group(world.page).getByRole("alert").waitFor(); const failedCalls = countOps(world, "session-list.page");
    await world.page.waitForTimeout(200); assert.equal(countOps(world, "session-list.page"), failedCalls, "error is not an observer retry storm");
    assert.deepEqual(await ids(world.page), numbers("n-", 30));
    world.holdPages.delete("workspace");
    // Invoke the real retry handler without scrolling to its offscreen button.
    await group(world.page).getByRole("button", { name: "当前空间对话：重试加载", exact: true }).evaluate(button => (button as HTMLButtonElement).click());
    await waitRows(world.page, 60); await scrollTail(world.page); await waitRows(world.page, 65);
    assert.deepEqual(await ids(world.page, true), numbers("t-")); assert.deepEqual(await ids(world.page), numbers("n-"));
    const all = await world.page.locator("#history .history-row[data-session-id]").evaluateAll(nodes => nodes.map(node => JSON.stringify([(node as HTMLElement).dataset.workspaceId, (node as HTMLElement).dataset.sessionId])));
    assert.equal(new Set(all).size, 130);
    await world.page.waitForTimeout(100); const initial = countOps(world, "session-list.initial");
    for (let i = 0; i < 20; ++i) world.publish("session-list");
    await world.page.waitForTimeout(250);
    assert.equal(countOps(world, "session-list.initial"), initial, "equal-revision count deliveries never restart titles");
    const pages = countOps(world, "session-list.page"); await scrollTail(world.page); await world.page.waitForTimeout(100);
    assert.equal(countOps(world, "session-list.page"), pages, "terminal tail performs no reads");
    facts.loaded = { top: await ids(world.page, true), workspace: await ids(world.page) }; facts.anchor = saved; facts.initial = initial;
  } },
  { name: "visible-exact-counts-and-late-replies", run: async (world, facts) => {
    populate(world, true); world.exactCounts.set("foreign:t-00", 123); world.exactCounts.set("w:t-01", 0);
    for (let i = 2; i < 65; ++i) world.exactCounts.set(`w:t-${String(i).padStart(2, "0")}`, 7);
    world.holdCounts = true; await world.ready(); await waitRows(world.page, 30, true);
    await until(() => world.pending("session-list.counts").length, "visible cold rows request exact counts");
    await world.page.waitForTimeout(60);
    const visibleRows = await visible(world.page), allowed = new Set(visibleRows.map(row => JSON.stringify([row.workspaceId, row.id])));
    const first = world.pending("session-list.counts");
    for (const read of first) {
      const ids = read.c.params!.sessionIds as string[];
      assert(ids.length > 0 && ids.length <= 30);
      for (const id of ids) assert(allowed.has(JSON.stringify([read.c.workspaceId, id])), `offscreen ${id} was counted`);
    }
    assert(first.some(read => read.c.workspaceId === "foreign"));
    assert(first.flatMap(read => read.c.params!.sessionIds as string[]).length < 30, "not all 60 mounted rows are scanned");
    world.holdCounts = false; first.forEach(read => world.answer(read));
    await world.page.waitForFunction(() => document.querySelector('[data-session-id="t-00"] .session-message-count')?.textContent?.includes("123 条"));
    await world.page.waitForFunction(() => document.querySelector('[data-session-id="t-01"] .session-message-count')?.textContent?.includes("0 条"));
    const initial = countOps(world, "session-list.initial"), saved = await anchor(world.page);
    world.exactCounts.set("w:t-01", 99); world.publish("session-list");
    await world.page.waitForFunction(() => document.querySelector('[data-session-id="t-01"] .session-message-count')?.textContent?.includes("99 条"));
    assert.equal(countOps(world, "session-list.initial"), initial); await assertAnchor(world.page, saved);
    world.holdCounts = true; world.publish("session-list");
    await until(() => world.pending("session-list.counts").some(read => (read.c.params!.sessionIds as string[]).includes("t-01")), "old context count is held");
    const old = world.pending("session-list.counts");
    world.exactCounts.set("w:t-01", 321); world.holdCounts = false;
    await world.page.getByRole("searchbox").fill("Top 01"); await waitRows(world.page, 1, true); await waitRows(world.page, 0);
    await world.page.waitForFunction(() => document.querySelector('[data-session-id="t-01"] .session-message-count')?.textContent?.includes("321 条"));
    for (const read of old) {
      read.data = { workspaceId: read.c.workspaceId, items: (read.c.params!.sessionIds as string[]).map(sessionId => ({ sessionId, messageCount: 999 })) };
      world.answer(read);
    }
    await world.page.waitForTimeout(100);
    assert.match(await row(world.page, "t-01").locator(".session-message-count").innerText(), /321 条/);
    assert(old.every(read => read.canceled), "query change cancels originating count RPCs");
    world.exactCounts.set("w:t-01", undefined); world.publish("session-list");
    await world.page.waitForFunction(() => document.querySelector('[data-session-id="t-01"] .session-message-count')?.textContent?.includes("— 条"));
    facts.initialVisible = visibleRows; facts.firstCountRequests = first.map(read => read.c); facts.oldRepliesCanceled = true; facts.zeroAndUnknownDistinct = true;
  } },
  ...[false, true].map(reconnect => ({ name: reconnect ? "reconnect-receipts-preserve-pending-depth" : "consecutive-receipts-preserve-pending-depth", run: async (world: World, facts: Record<string, unknown>) => {
    populate(world); await world.ready(); await waitRows(world.page, 30, true);
    await scrollTail(world.page, true); await waitRows(world.page, 60, true);
    await scrollTail(world.page); await waitRows(world.page, 60);
    await row(world.page, "n-40").evaluate(element => {
      const root = document.getElementById("history")!; root.scrollTop += element.getBoundingClientRect().top - root.getBoundingClientRect().top - 80; root.dispatchEvent(new Event("scroll"));
    }); await settle(world.page);
    const saved = await anchor(world.page), element = await row(world.page, saved.id).elementHandle();
    assert(saved.id.startsWith("n-") && Number(saved.id.slice(2)) >= 30, "the anchor must be beyond the first page");
    const pageStart = world.commands.length;
    world.holdInitial = true;
    const previousSockets = world.sockets.length;
    if (reconnect) {
      world.socket.close({ code: 1012, reason: "synthetic reconnect" });
      await until(() => world.sockets.length > previousSockets && world.pending("session-list.initial").length === 1, "reconnected bootstrap is held before acceptance");
    }
    const bootstrapCount = reconnect ? 1 : 0;
    const rename = async (id: string, title: string) => {
      await world.page.evaluate(({ id, title }) => {
        void (window as any).sessionSelection.command("session.rename", { title }, { workspaceId: "w", sessionId: id });
      }, { id, title });
      await until(() => [...world.pendingWrites.values()].some(c => c.sessionId === id), "rename command reaches synthetic server");
      const command = [...world.pendingWrites.values()].find(c => c.sessionId === id)!;
      const previous = world.sessions.get(`w:${id}`)!; world.replace({ ...previous, title }); world.receipt(command, {});
    };
    await rename("n-01", "First completed");
    await until(() => world.pending("session-list.initial").length === bootstrapCount + 1, "first receipt starts a held reader");
    await rename("n-02", "Second completed");
    await until(() => world.pending("session-list.initial").length === bootstrapCount + 2, "second receipt replaces the still-empty model");
    const pending = world.pending("session-list.initial"); assert(pending.slice(0, -1).every(read => read.canceled));
    assert.equal(await rows(world.page, true).count(), 60); assert.equal(await rows(world.page).count(), 60);
    world.holdInitial = false; world.answer(pending.at(-1)!);
    const restoredPages = () => world.commands.slice(pageStart).filter(c => c.op === "session-list.page");
    await until(() => ["top", "workspace"].every(group => restoredPages().some(c => c.params?.group === group)), "both groups rebuild their retained second page");
    await world.page.waitForFunction(() => [...document.querySelectorAll("#history section.history-group")].every(group => group.getAttribute("aria-busy") === "false"));
    await settle(world.page); assert.equal(await world.page.locator("#history [role=alert]").count(), 0);
    assert.equal(await rows(world.page, true).count(), 60); assert.equal(await rows(world.page).count(), 60);
    pending.slice(0, -1).forEach(read => world.answer(read)); await world.page.waitForTimeout(60);
    await assertAnchor(world.page, saved); assert.equal(await row(world.page, saved.id).evaluate((node, old) => node === old, element), true);
    assert.deepEqual(await ids(world.page), numbers("n-", 60)); assert.equal(restoredPages().length, 2);
    facts.depth = { top: 60, workspace: 60 }; facts.anchor = saved; facts.firstReaderCanceled = true; facts.reconnected = reconnect; facts.restoredPages = restoredPages();
  } })),

  { name: "held-editor-background-depth-refresh", run: async (world, facts) => {
    populate(world); await world.ready(); await row(world.page, "n-02").waitFor({ state: "attached" });
    const button = row(world.page, "n-02").locator("button.history-item"); await button.focus(); await button.press("F2");
    const input = row(world.page, "n-02").getByRole("textbox", { name: "会话标题", exact: true });
    await input.fill("Draft stays"); await input.evaluate(element => (element as HTMLInputElement).setSelectionRange(2, 7));
    const oldInput = await input.elementHandle(), oldRow = await row(world.page, "n-02").elementHandle();
    await scrollTail(world.page); await waitRows(world.page, 60);
    assert.equal(await input.evaluate((element, old) => element === old, oldInput), true);
    assert.deepEqual(await input.evaluate(element => ({ focus: document.activeElement === element, value: (element as HTMLInputElement).value,
      start: (element as HTMLInputElement).selectionStart, end: (element as HTMLInputElement).selectionEnd })), { focus: true, value: "Draft stays", start: 2, end: 7 });
    await row(world.page, "n-02").evaluate(element => {
      const root = document.getElementById("history")!; root.scrollTop += element.getBoundingClientRect().top - root.getBoundingClientRect().top - 80; root.dispatchEvent(new Event("scroll"));
    }); await settle(world.page); const saved = await anchor(world.page);
    const base = world.sessions.get("w:n-02")!;
    world.replace({ ...base, title: "Server changed", messageCount: 9 }); world.exactCounts.set("w:n-02", 9);
    world.holdInitial = true; world.invalidate();
    await until(() => world.pending("session-list.initial").length, "new revision initial is held");
    assert.equal(await rows(world.page).count(), 60, "background refresh does not collapse the displayed depth");
    world.holdInitial = false; world.pending("session-list.initial").forEach(read => world.answer(read));
    await world.page.waitForFunction(() => document.querySelector('[data-session-id="n-02"] .session-message-count')?.textContent?.includes("9 条"));
    await waitRows(world.page, 60); await assertAnchor(world.page, saved);
    assert.equal(await row(world.page, "n-02").evaluate((element, old) => element === old, oldRow), true);
    assert.equal(await input.evaluate((element, old) => element === old, oldInput), true);
    assert.deepEqual(await input.evaluate(element => ({ focus: document.activeElement === element, value: (element as HTMLInputElement).value,
      start: (element as HTMLInputElement).selectionStart, end: (element as HTMLInputElement).selectionEnd })), { focus: true, value: "Draft stays", start: 2, end: 7 });
    assert.equal(countOps(world, "session.rename"), 0); facts.sameRowAndInput = true; facts.depth = 60; facts.anchor = saved;
  } },
];
try {
  await vite.listen(); browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const requested = process.env.AXIOM_HISTORY_SCROLL_CASES?.split(",").filter(Boolean);
  const enabled = requested ? cases.filter(item => requested.includes(item.name)) : cases;
  assert(enabled.length && (!requested || enabled.length === requested.length));
  for (const scenario of enabled) {
    const page: Page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.stack ?? error.message));
    const world: World = new World(page, { workspaceId: "w", sessionId: "viewer" }, `http://127.0.0.1:${(vite.httpServer!.address() as { port: number }).port}`, "session-history-pages.tsx");
    const facts: Record<string, unknown> = {}; await world.install();
    try {
      await scenario.run(world, facts); assert.deepEqual(errors, []); assert.deepEqual(world.unexpected, []);
      assert.deepEqual(world.commands.filter(c => c.op === "subscribe" && (c.params?.scope === "pinned-sessions" || String(c.params?.scope).startsWith("sessions:"))), []);
      assert.deepEqual(await page.evaluate(() => JSON.parse(sessionStorage.getItem("view") ?? "null")), { workspaceId: "w", sessionId: "viewer" });
      reports.push({ name: scenario.name, passed: true, facts, commands: world.commands, errors, unexpected: world.unexpected }); console.log(`PASS ${scenario.name}`);
    } catch (error) {
      reports.push({ name: scenario.name, passed: false, error: String(error), facts, commands: world.commands, errors, unexpected: world.unexpected });
      await page.screenshot({ path: join(artifacts, `${scenario.name}.png`), fullPage: true }).catch(() => {});
      writeFileSync(join(artifacts, `${scenario.name}.html`), await page.content().catch(() => "")); throw error;
    } finally { await page.close(); }
  }
  console.log(`PASS session-history-scroll ${enabled.length} cases; artifacts ${artifacts}`);
} finally {
  writeFileSync(join(artifacts, "report.json"), JSON.stringify(reports, null, 2));
  await browser?.close(); await vite.close(); rmSync(temporary, { recursive: true, force: true });
}
