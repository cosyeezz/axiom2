// Actual History/Workbench DOM with an isolated synthetic WS server. Never
// imports a runner, starts the Axiom backend, reads real sessions or calls models.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { createServer } from "vite";
import { World, session } from "./fixtures/session-selection-world.js";

const temporary = mkdtempSync(join(tmpdir(), "axiom-history-pages-vite-"));
const artifacts = process.env.AXIOM_HISTORY_PAGES_ARTIFACTS ?? mkdtempSync(join(tmpdir(), "axiom-history-pages-evidence-"));
mkdirSync(artifacts, { recursive: true });
const vite = await createServer({ root: resolve("."), configFile: false, cacheDir: join(temporary, "cache"),
  server: { host: "127.0.0.1", port: 0, hmr: false }, esbuild: { jsx: "automatic" } });
const reports: unknown[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const group = (page: Page, top = false) => page.getByRole("region", { name: top ? "置顶会话" : "当前空间对话", exact: true });
const rows = (page: Page, top = false) => group(page, top).locator(".history-row[data-session-id]");
const settle = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const selected = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("view") ?? "null"));
const row = (page: Page, id: string) => page.locator(`#history .history-row[data-session-id="${id}"]`);
const main = (page: Page, id: string) => row(page, id).locator("button.history-item");
const paging = (page: Page, top: boolean, direction: "下一页" | "上一页" | "重试翻页") => page.getByRole("button", { name: `${top ? "置顶会话" : "当前空间对话"}：${direction}`, exact: true });
const numbers = (from: number, to: number, prefix: string) => Array.from({ length: to - from }, (_, i) => `${prefix}${String(from + i).padStart(2, "0")}`);
const writeCount = (world: World, op: string) => world.commands.filter(c => c.op === op).length;
const latestWrite = (world: World, op: string) => [...world.pendingWrites.values()].filter(c => c.op === op).at(-1)!;
async function until(check: () => unknown, message: string) {
  const deadline = Date.now() + 5000;
  while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(check(), message);
}
const ids = (page: Page, top = false) => rows(page, top).evaluateAll(elements => elements.filter(el => !(el as HTMLElement).hidden).map(el => el.getAttribute("data-session-id")));
const waitIds = (page: Page, expected: string[], top = false) => page.waitForFunction(({ expected, top }) => {
  const selector = `#history section[aria-label="${top ? "置顶会话" : "当前空间对话"}"] .history-row[data-session-id]`;
  const actual = [...document.querySelectorAll<HTMLElement>(selector)].filter(el => !el.hidden).map(el => el.dataset.sessionId);
  return JSON.stringify(actual) === JSON.stringify(expected);
}, { expected, top }, { timeout: 5000 });
async function programNext(page: Page) {
  // Deliberately activate the REAL DOM button without moving focus. A physical
  // pointer click would blur/save the editor by design; this is not a paint or
  // physical-click simulation, and still executes production paging handlers.
  await paging(page, false, "下一页").evaluate(button => (button as HTMLButtonElement).click());
}
const noLegacyTitles = (world: World) => assert.deepEqual(world.commands.filter(c => c.op === "subscribe" &&
  (c.params?.scope === "pinned-sessions" || String(c.params?.scope).startsWith("sessions:"))), [], "History never subscribes to a full title collection");
function populate(world: World) {
  world.add(session("viewer")); // Selected authority is intentionally outside both pages.
  for (let i = 0; i < 65; i++) {
    const id = String(i).padStart(2, "0");
    const top = world.add(session(`t-${id}`, i === 0 ? "foreign" : "w", { pinned: true, title: `Top ${id}`, updatedAt: 2000 - i }), true);
    world.pinned.push(top);
    world.add(session(`n-${id}`, "w", { title: `Ordinary ${id}`, updatedAt: 1000 - i }), true);
  }
}
const cases: { name: string; run(world: World, facts: Record<string, unknown>): Promise<void> }[] = [
  { name: "dual-group-pages", run: async (world, facts) => {
    populate(world);
    const c = { op: "session-list.initial", params: { query: "" }, workspaceId: "w", requestId: "oracle" };
    assert.equal(world.pageData(c, "top", null).items.length, 30, "synthetic initial really supplies a finite top page");
    assert.equal(world.pageData(c, "workspace", null).items.length, 30, "synthetic initial really supplies a finite ordinary page");
    await world.ready();
    await rows(world.page, true).first().waitFor(); await rows(world.page).first().waitFor(); await settle(world.page);
    facts.firstPair = { top: await rows(world.page, true).count(), workspace: await rows(world.page).count() };
    assert.equal(await rows(world.page, true).count(), 30, "History initially mounts only the first 30 top rows, not the 65-row candidate pool");
    assert.equal(await rows(world.page).count(), 30, "History initially mounts only the first 30 ordinary rows");
    assert.deepEqual(await selected(world.page), { workspaceId: "w", sessionId: "viewer" });
    noLegacyTitles(world);
    await paging(world.page, true, "下一页").click(); await waitIds(world.page, numbers(30, 60, "t-"), true);
    assert.deepEqual(await ids(world.page), numbers(0, 30, "n-"));
    await paging(world.page, false, "下一页").click(); await waitIds(world.page, numbers(30, 60, "n-"));
    await paging(world.page, true, "上一页").click(); await waitIds(world.page, numbers(0, 30, "t-"), true);
    assert.deepEqual(await ids(world.page), numbers(30, 60, "n-"));
    world.holdPages.add("workspace");
    await paging(world.page, false, "下一页").click();
    await until(() => world.pending("session-list.page", "workspace").length, "next page is held at the server");
    const held = world.pending("session-list.page", "workspace")[0];
    assert.deepEqual(await ids(world.page), numbers(30, 60, "n-"), "in-flight page preserves its old 30 rows");
    await paging(world.page, true, "下一页").click(); await waitIds(world.page, numbers(30, 60, "t-"), true);
    world.answer(held, "PAGE_UNAVAILABLE");
    await group(world.page).getByRole("alert").waitFor();
    assert.deepEqual(await ids(world.page), numbers(30, 60, "n-"));
    world.holdPages.delete("workspace");
    await paging(world.page, false, "重试翻页").click(); await waitIds(world.page, numbers(60, 65, "n-"));
    assert.equal(await paging(world.page, false, "下一页").isDisabled(), true);
    assert.deepEqual(await ids(world.page, true), numbers(30, 60, "t-"), "single-group error/retry does not reset the other page");
    await paging(world.page, false, "上一页").click(); await waitIds(world.page, numbers(30, 60, "n-"));
    await paging(world.page, false, "上一页").click(); await waitIds(world.page, numbers(0, 30, "n-"));
    await paging(world.page, true, "下一页").click(); await waitIds(world.page, numbers(60, 65, "t-"), true);
    assert.equal(await paging(world.page, true, "下一页").isDisabled(), true, "top has its own terminal five-row page");
    await paging(world.page, true, "上一页").click(); await waitIds(world.page, numbers(30, 60, "t-"), true);
    await paging(world.page, true, "上一页").click(); await waitIds(world.page, numbers(0, 30, "t-"), true);
    assert.equal(await paging(world.page, false, "上一页").isDisabled(), true);
    assert.deepEqual(await selected(world.page), { workspaceId: "w", sessionId: "viewer" });
    facts.finalPair = { top: await ids(world.page, true), workspace: await ids(world.page) };
    facts.failedPageRequest = held.c.requestId;
  } },
  { name: "raw-full-search-family", run: async (world, facts) => {
    populate(world);
    world.add(session("space-a", "w", { title: "Start Alpha End", updatedAt: -1 }), true);
    world.add(session("space-b", "w", { title: "StartAlphaEnd", updatedAt: -2 }), true);
    world.add(session("family-root", "w", { title: "Family root", updatedAt: 1 }), true);
    for (let i = 0; i < 39; i++) world.add(session(`family-${String(i).padStart(2, "0")}`, "w", {
      title: `Family child ${i}`, forkParentSessionId: "family-root", pinned: i === 18, updatedAt: 5000 - i }), true);
    await world.ready(); await rows(world.page).first().waitFor();
    const search = world.page.getByRole("searchbox");
    await search.fill("Ordinary 64"); await waitIds(world.page, ["n-64"]);
    await search.fill(" Alpha "); await waitIds(world.page, ["space-a"]);
    await search.fill("Alpha"); await waitIds(world.page, ["space-a", "space-b"]);
    await search.fill("Family");
    const family = ["family-root", "family-18", ...numbers(0, 39, "family-").filter(id => id !== "family-18")];
    await waitIds(world.page, family.slice(0, 30), true); await waitIds(world.page, []);
    assert.equal(await row(world.page, "family-root").getAttribute("data-family-top"), "true", "non-top root uses server family grouping");
    await paging(world.page, true, "下一页").click(); await waitIds(world.page, family.slice(30), true);
    assert.equal(await rows(world.page).count(), 0, "page-2 children without their root are not locally regrouped");
    assert.deepEqual(await rows(world.page, true).evaluateAll(elements => elements.map(el => el.getAttribute("data-family-id"))), Array(10).fill("family-root"));
    assert.equal(await paging(world.page, true, "下一页").isDisabled(), true);
    const queries = world.commands.filter(c => c.op === "session-list.initial").map(c => c.params?.query);
    for (const raw of ["Ordinary 64", " Alpha ", "Alpha", "Family"]) assert.ok(queries.includes(raw), `RPC retains exact raw query ${JSON.stringify(raw)}`);
    assert.deepEqual(await selected(world.page), { workspaceId: "w", sessionId: "viewer" });
    assert.equal(writeCount(world, "session-list.first"), 0); noLegacyTitles(world);
    facts.queries = queries; facts.familyPages = [family.slice(0, 30), family.slice(30)];
  } },
  { name: "held-input-and-ime", run: async (world, facts) => {
    populate(world); await world.ready(); await row(world.page, "n-02").waitFor();
    const originalRow = await row(world.page, "n-02").elementHandle();
    await main(world.page, "n-02").focus(); await main(world.page, "n-02").press("F2");
    const input = row(world.page, "n-02").getByRole("textbox", { name: "会话标题", exact: true });
    await input.fill("Draft stays"); const originalInput = await input.elementHandle();
    await input.evaluate(element => (element as HTMLInputElement).setSelectionRange(2, 7));
    await programNext(world.page); await row(world.page, "n-30").waitFor();
    assert.equal(await row(world.page, "n-02").evaluate((element, old) => element === old, originalRow), true);
    assert.equal(await input.evaluate((element, old) => element === old, originalInput), true);
    assert.deepEqual(await input.evaluate(element => ({ focus: document.activeElement === element, value: (element as HTMLInputElement).value,
      start: (element as HTMLInputElement).selectionStart, end: (element as HTMLInputElement).selectionEnd })), { focus: true, value: "Draft stays", start: 2, end: 7 });
    assert.equal(await row(world.page, "n-02").evaluate(element => [...element.parentElement!.querySelectorAll(".history-row")].indexOf(element)), 2);
    const base = world.sessions.get("w:n-02")!;
    world.replace({ ...base, title: "Server C", messageCount: 9 }); world.invalidate();
    await world.page.waitForFunction(() => document.querySelector('[data-session-id="n-02"] .session-message-count')?.textContent?.includes("9 条"));
    assert.equal(await input.inputValue(), "Draft stays", "accepted raw metadata does not overwrite the input draft");
    assert.equal(await input.evaluate((element, old) => element === old, originalInput), true);
    await input.dispatchEvent("compositionstart"); await input.fill("组合输入新标题");
    await input.evaluate(element => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, isComposing: true, bubbles: true })));
    await world.page.getByRole("searchbox").fill("no-current-match"); await world.page.waitForTimeout(100);
    assert.equal(writeCount(world, "session.rename"), 0, "composition blur and key229 cannot prematurely save");
    assert.equal(await input.evaluate((element, old) => element === old, originalInput), true, "raw-query changes do not unmount an active composition");
    await input.dispatchEvent("compositionend");
    await until(() => writeCount(world, "session.rename") === 1, "compositionend saves the deferred blur exactly once");
    const rename = latestWrite(world, "session.rename"); assert.equal(rename.params?.title, "组合输入新标题");
    world.fail(rename, "RENAME_REJECTED"); await world.page.waitForTimeout(100);
    assert.equal(writeCount(world, "session.rename"), 1);
    assert.deepEqual(await selected(world.page), { workspaceId: "w", sessionId: "viewer" });
    facts.sameRowAndInput = true; facts.originalAnchor = 2; facts.renameCount = 1;
  } },
  { name: "held-neighbor-reorder", run: async (world, facts) => {
    populate(world); await world.ready(); await row(world.page, "n-02").waitFor();
    await main(world.page, "n-02").focus(); await main(world.page, "n-02").press("F2");
    const input = row(world.page, "n-02").getByRole("textbox", { name: "会话标题", exact: true });
    await input.fill("must retain draft"); const original = await input.elementHandle();
    world.replace({ ...world.sessions.get("w:n-10")!, updatedAt: 99999 }); world.invalidate();
    await world.page.waitForFunction(() => document.querySelector('[aria-label="当前空间对话"] .history-row')?.getAttribute("data-session-id") === "n-10");
    await settle(world.page);
    facts.afterReorder = { inputCount: await input.count(), renames: writeCount(world, "session.rename"),
      active: await world.page.evaluate(() => document.activeElement?.getAttribute("aria-label")) };
    assert.equal(await input.count(), 1, "neighbor reorder cannot blur and save an actively held editor");
    assert.equal(await input.evaluate((element, old) => element === old && document.activeElement === element, original), true,
      "same-node identity alone is insufficient: the original editor must stay focused without DOM reinsertion");
    assert.equal(await input.inputValue(), "must retain draft"); assert.equal(writeCount(world, "session.rename"), 0);
  } },
  { name: "pointer-unread-and-pin", run: async (world, facts) => {
    populate(world);
    const attention = world.add(session("attention", "w", { unread: true, updatedAt: 9999 }), true);
    await world.ready(); await row(world.page, "attention").waitFor();
    const original = await row(world.page, "attention").elementHandle();
    await main(world.page, "attention").click();
    world.replace({ ...attention, unread: false }); world.publish("session:w:attention"); world.invalidate();
    await world.page.waitForFunction(() => document.querySelector('[data-session-id="attention"]')?.getAttribute("data-family-top") === "false");
    assert.equal(await row(world.page, "attention").evaluate((element, old) => element === old, original), true);
    assert.equal(await group(world.page, true).locator('[data-session-id="attention"]').count(), 1);
    assert.equal(await group(world.page).locator('[data-session-id="attention"]').count(), 0);
    await main(world.page, "attention").dblclick(); await row(world.page, "attention").getByRole("textbox").press("Escape"); await settle(world.page);
    assert.equal(await row(world.page, "attention").evaluate((element, old) => element === old, original), true);
    const foreign = world.sessions.get("foreign:t-00")!, foreignNode = await row(world.page, "t-00").elementHandle();
    world.holdInitial = true;
    await row(world.page, "t-00").hover(); await row(world.page, "t-00").locator(".session-pin").click();
    await until(() => writeCount(world, "session.pin") === 1, "foreign unpin dispatched");
    const readMark = world.reads.length;
    world.replace({ ...foreign, pinned: false }); world.receipt(latestWrite(world, "session.pin"), {});
    await until(() => world.reads.slice(readMark).some(read => read.c.op === "session-list.initial" && !read.canceled), "foreign completion fences current workspace reads");
    for (const read of world.pending("session-list.initial")) world.answer(read);
    await world.page.waitForFunction(() => document.querySelector<HTMLButtonElement>('[aria-label="置顶会话：下一页"]')?.disabled === false);
    assert.equal(await row(world.page, "t-00").locator(".session-pin").getAttribute("aria-pressed"), "false");
    assert.equal(await row(world.page, "t-00").evaluate((element, old) => element === old, foreignNode), true);
    await world.page.getByRole("searchbox").focus(); await world.page.mouse.move(1000, 100);
    await row(world.page, "t-00").waitFor({ state: "detached" });
    world.holdInitial = false;
    const ordinary = world.sessions.get("w:n-00")!, ordinaryNode = await row(world.page, "n-00").elementHandle();
    await row(world.page, "n-00").locator(".session-pin").focus(); await row(world.page, "n-00").locator(".session-pin").press("Enter");
    await until(() => writeCount(world, "session.pin") === 2, "keyboard pin dispatched");
    // Keep this target in the authoritative first top page. A page-external
    // held snapshot must not invent family metadata or a destination slot.
    world.replace({ ...ordinary, pinned: true, updatedAt: 99999 });
    const freshTarget = world.pageData({ requestId: "keyboard-pin-fixture", op: "session-list.initial", workspaceId: "w", params: { query: "" } }, "top", null)
      .items.find(item => item.id === "n-00");
    assert.equal(freshTarget?.familyTop, true, "keyboard pin fixture must include the target in the fresh server page");
    world.receipt(latestWrite(world, "session.pin"), {});
    await world.page.waitForFunction(() => document.querySelector('[data-session-id="n-00"]')?.getAttribute("data-family-top") === "true" &&
      document.querySelector('[data-session-id="n-00"] .session-pin')?.getAttribute("aria-pressed") === "true");
    await settle(world.page);
    assert.equal(await row(world.page, "n-00").evaluate((element, old) => element === old, ordinaryNode), true);
    assert.equal(await group(world.page).locator('[data-session-id="n-00"]').count(), 1, "keyboard pin keeps the original parent while focused");
    await world.page.getByRole("searchbox").focus(); await world.page.mouse.move(1000, 100);
    await world.page.waitForFunction(() => document.querySelector('[aria-label="置顶会话"] [data-session-id="n-00"]'));
    assert.equal(await row(world.page, "n-00").count(), 1);
    assert.equal((await selected(world.page)).sessionId, "attention");
    facts.foreignAndKeyboardPin = true; facts.pointerRowStayedMounted = true;
  } },
  { name: "off-page-delete-rollback", run: async (world, facts) => {
    populate(world); await world.ready(); await row(world.page, "n-02").waitFor();
    const original = await row(world.page, "n-02").elementHandle();
    await main(world.page, "n-02").focus(); await programNext(world.page); await row(world.page, "n-30").waitFor();
    const dialog = world.page.getByRole("dialog", { name: "删除会话", exact: true });
    await main(world.page, "n-02").press("Delete"); await dialog.waitFor();
    const modalNode = await dialog.elementHandle(); world.publish("session-list"); await waitIds(world.page, numbers(0, 30, "n-"));
    assert.equal(await dialog.evaluate((element, old) => element === old, modalNode), true, "server refresh cannot remount the body portal confirmation");
    await world.page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
    await row(world.page, "n-02").locator(".session-delete").focus(); await row(world.page, "n-02").locator(".session-delete").press("Enter");
    await dialog.waitFor(); await world.page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
    await row(world.page, "n-02").hover(); await row(world.page, "n-02").locator(".session-delete").click(); await world.page.keyboard.press("Escape");
    await world.page.waitForTimeout(650); assert.equal(await dialog.count(), 0); assert.equal(writeCount(world, "session.delete"), 0);
    await row(world.page, "n-02").locator(".session-delete").click(); await dialog.waitFor();
    await world.page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
    await main(world.page, "n-02").focus(); await programNext(world.page); await row(world.page, "n-30").waitFor();
    await main(world.page, "n-02").press("Delete"); await dialog.waitFor();
    await dialog.getByRole("button", { name: "删除会话", exact: true }).click();
    await until(() => writeCount(world, "session.delete") === 1, "confirmed delete dispatched");
    assert.equal(await row(world.page, "n-02").isHidden(), true);
    assert.equal(await row(world.page, "n-02").evaluate((element, old) => element === old, original), true);
    assert.equal(await row(world.page, "n-02").evaluate(element => (element as HTMLElement).inert && (element as HTMLElement).hidden && getComputedStyle(element).display === "none"), true);
    world.fail(latestWrite(world, "session.delete"), "DELETE_REJECTED");
    await row(world.page, "n-02").waitFor({ state: "visible" });
    assert.equal(await row(world.page, "n-02").evaluate((element, old) => element === old, original), true, "off-page rollback restores the original instance");
    await world.page.waitForFunction(() => document.querySelector('[data-session-id="n-02"] button.history-item') === document.activeElement);
    await row(world.page, "n-02").hover(); await row(world.page, "n-02").locator(".session-delete").dblclick();
    await until(() => writeCount(world, "session.delete") === 2, "double click deletes directly exactly once");
    assert.equal(await dialog.count(), 0);
    world.holdInitial = true;
    world.lists.set("w", world.lists.get("w")!.filter(value => value.id !== "n-02")); world.sessions.delete("w:n-02");
    world.receipt(latestWrite(world, "session.delete"), {});
    await row(world.page, "n-02").waitFor({ state: "detached" });
    await until(() => world.pending("session-list.initial").length, "completed delete refresh held");
    for (const read of world.pending("session-list.initial")) world.answer(read);
    await world.page.waitForTimeout(650);
    assert.equal(await row(world.page, "n-02").count(), 0, "old async finally/timer cannot rehold a completed deletion");
    assert.equal(await original!.evaluate(element => element.isConnected), false);
    assert.equal(await dialog.count(), 0); assert.equal(writeCount(world, "session.delete"), 2);
    assert.deepEqual(await selected(world.page), { workspaceId: "w", sessionId: "viewer" });
    facts.sameInstanceRollback = true; facts.deleteEntrances = ["row Delete", "keyboard button", "500ms single pointer", "double pointer"];
  } },
  { name: "delete-does-not-steal-focus", run: async (world, facts) => {
    populate(world); await world.ready(); await row(world.page, "n-02").waitFor();
    await main(world.page, "n-02").focus(); await main(world.page, "n-02").press("Delete");
    await world.page.getByRole("dialog", { name: "删除会话", exact: true }).getByRole("button", { name: "删除会话", exact: true }).click();
    await until(() => writeCount(world, "session.delete") === 1, "delete dispatched before user moves focus");
    await world.page.locator("#prompt").focus(); world.fail(latestWrite(world, "session.delete"), "DELETE_REJECTED");
    await main(world.page, "n-02").waitFor(); await settle(world.page);
    assert.equal(await world.page.locator("#prompt").evaluate(element => document.activeElement === element), true,
      "failed delete cannot steal focus back after the user focused another control");
    facts.userFocusPreserved = true;
  } },
  { name: "offline-controls", run: async (world, facts) => {
    populate(world); await world.ready(); await waitIds(world.page, numbers(0, 30, "t-"), true); await waitIds(world.page, numbers(0, 30, "n-"));
    world.holdPages.add("workspace"); await paging(world.page, false, "下一页").click();
    await until(() => world.pending("session-list.page", "workspace").length, "page in flight before disconnect");
    world.offline = true; world.socket.close();
    await world.page.getByText("已离线，显示已加载会话", { exact: true }).waitFor();
    await waitIds(world.page, numbers(0, 30, "t-"), true); await waitIds(world.page, numbers(0, 30, "n-"));
    for (const top of [true, false]) for (const direction of ["上一页", "下一页"] as const)
      assert.equal(await paging(world.page, top, direction).isDisabled(), true);
    const count = world.commands.filter(c => c.op.startsWith("session-list.")).length;
    await paging(world.page, false, "下一页").evaluate(element => (element as HTMLButtonElement).click()); await settle(world.page);
    assert.equal(world.commands.filter(c => c.op.startsWith("session-list.")).length, count, "disabled offline controls do not read another page");
    world.holdInitial = true; world.offline = false;
    await until(() => world.pending("session-list.initial").length, "reconnect starts a real fresh initial");
    for (const top of [true, false]) for (const direction of ["上一页", "下一页"] as const)
      assert.equal(await paging(world.page, top, direction).isDisabled(), true, "new generation is not pageable until fresh initial accepts");
    world.holdInitial = false; world.holdPages.clear();
    for (const read of world.pending("session-list.initial")) world.answer(read);
    await world.page.waitForFunction(() => !(document.querySelector('[aria-label="当前空间对话：下一页"]') as HTMLButtonElement)?.disabled);
    await waitIds(world.page, numbers(0, 30, "t-"), true); await waitIds(world.page, numbers(0, 30, "n-"));
    assert.deepEqual(await selected(world.page), { workspaceId: "w", sessionId: "viewer" });
    facts.offlineRowsPreserved = true; facts.disabledUntilFreshAccepts = true; facts.connections = world.sockets.length;
  } },
  { name: "receipt-bridge-fresh-C", run: async (world, facts) => {
    populate(world); const base = world.sessions.get("w:n-02")!; world.replace({ ...base, messageCount: 7 });
    await world.ready(); await row(world.page, "n-02").waitFor(); const original = await row(world.page, "n-02").elementHandle();
    await main(world.page, "n-02").focus(); await main(world.page, "n-02").press("F2");
    await row(world.page, "n-02").getByRole("textbox").fill("B");
    world.holdInitial = true; world.publish("session-list");
    await until(() => world.pending("session-list.initial").length, "pre-receipt A initial held");
    const old = world.pending("session-list.initial")[0];
    await row(world.page, "n-02").getByRole("textbox").press("Enter");
    await until(() => writeCount(world, "session.rename") === 1, "rename B dispatched");
    world.replace({ ...base, title: "C", messageCount: undefined }); world.receipt(latestWrite(world, "session.rename"), {});
    await until(() => old.canceled && world.pending("session-list.initial").some(read => read !== old), "receipt cancels A and starts post-fence C read");
    const fresh = world.pending("session-list.initial").find(read => read !== old)!;
    world.answer(old); await settle(world.page);
    assert.equal(await row(world.page, "n-02").locator("strong").textContent(), "B", "late A cannot overwrite confirmed B");
    world.answer(fresh, "INITIAL_UNAVAILABLE"); await world.page.getByRole("button", { name: "重试会话列表", exact: true }).waitFor();
    assert.equal(await row(world.page, "n-02").locator("strong").textContent(), "B", "fresh read failure keeps the bridge");
    await world.page.getByRole("button", { name: "重试会话列表", exact: true }).click();
    await until(() => world.pending("session-list.initial").length, "explicit retry issues a real initial");
    await main(world.page, "n-02").focus();
    world.answer(world.pending("session-list.initial")[0]);
    await world.page.waitForFunction(() => document.querySelector('[data-session-id="n-02"] strong')?.textContent === "C");
    assert.match(await row(world.page, "n-02").locator(".session-message-count").textContent() ?? "", /—/);
    assert.equal(await row(world.page, "n-02").evaluate((element, old) => element === old, original), true);
    world.holdInitial = false; await programNext(world.page); await row(world.page, "n-30").waitFor();
    assert.equal(await row(world.page, "n-02").locator("strong").textContent(), "C", "accepted raw C persists after leaving its page");
    await main(world.page, "n-02").press("F2"); await row(world.page, "n-02").getByRole("textbox").fill("D");
    await row(world.page, "n-02").getByRole("textbox").press("Enter");
    await until(() => writeCount(world, "session.rename") === 2, "later D dispatched");
    world.fail(latestWrite(world, "session.rename"), "D_REJECTED");
    await world.page.waitForFunction(() => document.querySelector('[data-session-id="n-02"] strong')?.textContent === "C");
    assert.match(await row(world.page, "n-02").locator(".session-message-count").textContent() ?? "", /—/);
    facts.canceledA = old.c.requestId; facts.acceptedCThenRollback = true;
  } },
  { name: "completion-rekey-baseline", run: async (world, facts) => {
    populate(world); const base = world.sessions.get("w:n-02")!;
    await world.ready(); await row(world.page, "n-02").waitFor();
    await world.page.locator("#prompt").focus(); await world.page.mouse.move(1000, 100); world.holdInitial = true;
    await world.page.evaluate(() => { void (window as any).sessionSelection.command("session.rename", { title: "B" }, { workspaceId: "w", sessionId: "n-02" }).catch(() => {}); });
    await until(() => writeCount(world, "session.rename") === 1, "external B dispatched");
    world.replace({ ...base, title: "B", updatedAt: 1 }); world.receipt(latestWrite(world, "session.rename"), {});
    await until(() => world.pending("session-list.initial").length, "fresh page omitting B held");
    const beforeRekey = await row(world.page, "n-02").elementHandle(); await main(world.page, "n-00").focus();
    await world.page.waitForFunction(old => document.querySelector('[data-session-id="n-02"]') !== old, beforeRekey);
    const acquired = await row(world.page, "n-02").elementHandle(); await main(world.page, "n-02").focus();
    for (const read of world.pending("session-list.initial")) world.answer(read);
    await row(world.page, "n-30").waitFor(); await settle(world.page);
    assert.equal(await row(world.page, "n-02").locator("strong").textContent(), "B", "normal-row rekey must hand completed B to its next acquire, not stale page A");
    assert.equal(await row(world.page, "n-02").evaluate((element, old) => element === old, acquired), true, "after acquire the new instance remains held");
    await world.page.getByRole("searchbox").focus(); await world.page.mouse.move(1000, 100);
    await row(world.page, "n-02").waitFor({ state: "detached" }); assert.equal(await rows(world.page).count(), 30);
    facts.normalRemountBeforeAcquire = true; facts.completedBaselineHandedOver = true;
  } },
  { name: "mounted-completion-baseline", run: async (world, facts) => {
    populate(world); const base = world.sessions.get("w:n-02")!;
    await world.ready(); await row(world.page, "n-02").waitFor();
    await world.page.locator("#prompt").focus(); await world.page.mouse.move(1000, 100);
    const original = await row(world.page, "n-02").elementHandle(); world.holdInitial = true;
    await world.page.evaluate(() => { void (window as any).sessionSelection.command("session.rename", { title: "B" }, { workspaceId: "w", sessionId: "n-02" }).catch(() => {}); });
    await until(() => writeCount(world, "session.rename") === 1, "external rename dispatched without an interaction hold");
    world.replace({ ...base, title: "B", updatedAt: 1 }); world.receipt(latestWrite(world, "session.rename"), {});
    await until(() => world.pending("session-list.initial").length, "post-receipt page omitting the target is held");
    await main(world.page, "n-02").focus(); // Acquire AFTER completion, while raw page still says A.
    for (const read of world.pending("session-list.initial")) world.answer(read);
    await row(world.page, "n-30").waitFor(); await settle(world.page);
    assert.equal(await row(world.page, "n-02").locator("strong").textContent(), "B", "new hold uses completed mount baseline, not stale page A");
    assert.equal(await row(world.page, "n-02").evaluate((element, old) => element === old, original), true);
    await world.page.getByRole("searchbox").focus(); await world.page.mouse.move(1000, 100);
    await row(world.page, "n-02").waitFor({ state: "detached" });
    assert.equal(await rows(world.page).count(), 30, "released mount does not become an old-page cache");
    facts.postCompletionAcquire = true;
  } },
];
try {
  await vite.listen();
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const requested = process.env.AXIOM_HISTORY_PAGES_CASES?.split(",").filter(Boolean);
  const enabled = requested ? cases.filter(item => requested.includes(item.name)) : cases;
  assert.ok(enabled.length && (!requested || enabled.length === requested.length), "all requested History scenario names exist");
  for (const scenario of enabled) {
    const page: Page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.stack ?? error.message));
    const diagnostics: { type: string; message: string }[] = [];
    page.on("console", message => { if (message.type() === "error" || message.type() === "warning") diagnostics.push({ type: message.type(), message: message.text() }); });
    page.on("requestfailed", request => diagnostics.push({ type: "requestfailed", message: `${request.url()} ${request.failure()?.errorText}` }));
    const port = (vite.httpServer!.address() as { port: number }).port;
    const world: World = new World(page, { workspaceId: "w", sessionId: "viewer" }, `http://127.0.0.1:${port}`, "session-history-pages.tsx");
    const facts: Record<string, unknown> = {};
    await world.install();
    try {
      await scenario.run(world, facts); assert.deepEqual(errors, []); assert.deepEqual(world.unexpected, []);
      reports.push({ name: scenario.name, passed: true, facts, selected: await selected(page), commands: world.commands, errors, unexpected: world.unexpected, diagnostics });
      console.log(`PASS ${scenario.name}`);
    } catch (error) {
      reports.push({ name: scenario.name, passed: false, error: String(error), facts, selected: await selected(page).catch(() => null), commands: world.commands, errors, unexpected: world.unexpected, diagnostics });
      await page.screenshot({ path: join(artifacts, `${scenario.name}.png`), fullPage: true }).catch(() => {});
      writeFileSync(join(artifacts, `${scenario.name}.html`), await page.content().catch(() => ""));
      throw error;
    } finally { await page.close(); }
  }
  console.log(`PASS session-history-pages ${enabled.length} cases; artifacts ${artifacts}`);
} finally {
  writeFileSync(join(artifacts, "report.json"), JSON.stringify(reports, null, 2));
  await browser?.close(); await vite.close(); rmSync(temporary, { recursive: true, force: true });
}
