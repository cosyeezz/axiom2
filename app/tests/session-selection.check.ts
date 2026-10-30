// Real Workbench/hooks/Composer with a wholly synthetic WS backend. No model,
// real Store, personal session data or running Axiom backend is involved.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { createServer } from "vite";
import type { Scope } from "../src/shared/protocol.js";
import { World, session, workspace } from "./fixtures/session-selection-world.js";

const temporary = mkdtempSync(join(tmpdir(), "axiom-session-selection-vite-"));
const artifacts = process.env.AXIOM_SELECTION_ARTIFACTS ?? mkdtempSync(join(tmpdir(), "axiom-session-selection-evidence-"));
mkdirSync(artifacts, { recursive: true });
const vite = await createServer({ root: resolve("."), configFile: false, cacheDir: join(temporary, "cache"),
  server: { host: "127.0.0.1", port: 0, hmr: false }, esbuild: { jsx: "automatic" } });
const reports: unknown[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const selected = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem("view") ?? "null") as Scope | null);
const settle = (page: Page) => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
async function until(check: () => unknown, description: string) {
  const deadline = Date.now() + 5000;
  while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(check(), description);
}
const firstCount = (world: World) => world.commands.filter(c => c.op === "session-list.first").length;
const pendingWrite = (world: World, op: string) => [...world.pendingWrites.values()].find(c => c.op === op);
const waitSelected = (page: Page, id: string, workspaceId = "w") => page.waitForFunction(({ id, workspaceId }) => {
  const value = JSON.parse(sessionStorage.getItem("view") ?? "null");
  return value?.sessionId === id && value.workspaceId === workspaceId;
}, { id, workspaceId }, { timeout: 5000 });
async function beginDelete(world: World, sessionId = "a", workspaceId = "w") {
  await world.page.evaluate(({ sessionId, workspaceId }) => {
    void (window as any).sessionSelection.command("session.delete", { confirmed: true }, { workspaceId, sessionId }, `delete-${workspaceId}-${sessionId}`).catch(() => {});
  }, { sessionId, workspaceId });
  await until(() => world.pendingWrites.get(`delete-${workspaceId}-${sessionId}`), "delete command dispatched after paint");
  return world.pendingWrites.get(`delete-${workspaceId}-${sessionId}`)!;
}

const cases: { name: string; run: (world: World) => Promise<void>; view?: Scope }[] = [
  { name: "outside-list", view: { workspaceId: "w", sessionId: "outside" }, run: async world => {
    world.add(session("visible"), true); world.add(session("outside")); world.firstValue = session("visible");
    await world.ready();
    assert.deepEqual(await selected(world.page), { workspaceId: "w", sessionId: "outside" }, "a real selected summary remains valid outside the finite title collections");
    assert.equal(world.commands.filter(c => c.op === "session-list.first").length, 0, "known selected session never needs a first fallback");
    await world.page.getByRole("searchbox", { name: "搜索置顶和当前空间的会话" }).fill("no-title-matches"); await settle(world.page);
    assert.equal((await selected(world.page))?.sessionId, "outside", "search only hides titles; it cannot remove the viewer");
  } },
  { name: "delete-preview", run: async world => {
    world.add(session("a"), true); world.add(session("old-local-first"), true);
    const serverFirst = world.add(session("independent-first", "w", { updatedAt: 20 })); world.firstValue = serverFirst;
    await world.ready();
    const afterBegin = await world.page.evaluate(() => {
      void (window as any).sessionSelection.command("session.delete", { confirmed: true }, { workspaceId: "w", sessionId: "a" }, "delete-a").catch(() => {});
      return JSON.parse(sessionStorage.getItem("view")!);
    });
    assert.deepEqual(afterBegin, { workspaceId: "w", sessionId: "" }, "delete begins on a real empty workspace surface, not a guessed cached title");
    await world.page.waitForTimeout(150);
    assert.equal(world.commands.filter(c => c.op === "session-list.first").length, 0, "pending deletion cannot read pre-commit first");
    const deleting = world.pendingWrites.get("delete-a"); assert.ok(deleting, "real production command is dispatched after paint");
    world.sessions.delete("w:a"); world.lists.set("w", world.lists.get("w")!.filter(s => s.id !== "a"));
    world.publish("sessions:w"); world.publish("session:w:a"); world.invalidate(); world.receipt(deleting, {});
    await world.page.waitForFunction(() => JSON.parse(sessionStorage.getItem("view") ?? "null")?.sessionId === "independent-first", null, { timeout: 5000 });
    assert.ok(world.commands.some(c => c.op === "session-list.first" && c.workspaceId === "w"));
  } },
  { name: "foreign-delete", view: { workspaceId: "foreign", sessionId: "a" }, run: async world => {
    world.add(session("sidebar-first"), true); world.add(session("a", "foreign"));
    const foreignFirst = world.add(session("foreign-first", "foreign")); world.firstValue = foreignFirst;
    await world.ready();
    assert.deepEqual(await selected(world.page), { workspaceId: "foreign", sessionId: "a" });
    assert.equal(world.commands.filter(c => c.op === "subscribe" && c.params?.scope === "sessions:foreign").length, 0, "a foreign viewer needs its summary, not another full title collection");
    const deleting = await beginDelete(world, "a", "foreign");
    assert.deepEqual(await selected(world.page), { workspaceId: "foreign", sessionId: "" });
    assert.equal(await world.page.evaluate(() => sessionStorage.getItem("sidebarWorkspaceId")), "w");
    assert.equal(firstCount(world), 0);
    world.sessions.delete("foreign:a"); world.invalidate(); world.receipt(deleting, {});
    await waitSelected(world.page, "foreign-first", "foreign");
    assert.ok(world.commands.filter(c => c.op === "session-list.first").every(c => c.workspaceId === "foreign"));
  } },
  { name: "authority-and-read-error", run: async world => {
    world.add(session("cached-first"), true); world.mutedScopes.add("session:w:a"); world.holdFirst = true;
    const first = world.add(session("after-retry"));
    await world.ready(); await world.page.waitForTimeout(100);
    assert.equal((await selected(world.page))?.sessionId, "a", "undefined summary is loading, not deleted"); assert.equal(firstCount(world), 0);
    world.mutedScopes.delete("session:w:a"); world.publish("session:w:a");
    await until(() => world.pendingFirst.length, "real null summary starts independent first");
    world.fail(world.pendingFirst.at(-1)!, "FIRST_UNAVAILABLE");
    await world.page.getByText("FIRST_UNAVAILABLE", { exact: true }).waitFor();
    assert.equal((await selected(world.page))?.sessionId, "a", "failed first does not fabricate an empty surface");
    const failedCount = firstCount(world); await world.page.waitForTimeout(150); assert.equal(firstCount(world), failedCount, "an error render does not form a retry loop");
    world.holdFirst = false; world.firstValue = first; world.invalidate(); await waitSelected(world.page, first.id);
  } },
  { name: "first-null-stable", run: async world => {
    world.add(session("cached-first"), true); world.firstValue = null;
    await world.ready(); await waitSelected(world.page, ""); await world.page.waitForTimeout(150);
    const writes = () => world.commands.filter(c => c.op === "workspace.select" && Object.hasOwn(c.params ?? {}, "view")).length;
    assert.equal(writes(), 1, "only actual missing-to-empty navigation writes preferences");
    const before = firstCount(world); assert.ok(before > 0);
    await world.page.waitForTimeout(150); assert.equal(firstCount(world), before, "a settled null cannot self-trigger reads");
    world.publish("session-list"); await until(() => firstCount(world) > before, "same-revision invalidation is still observed");
    await world.page.waitForTimeout(150); assert.equal(writes(), 1); assert.equal(firstCount(world), before + 1);
  } },
  { name: "delete-rollback", run: async world => {
    world.add(session("a"), true); world.firstValue = world.add(session("wrong-fallback"));
    await world.ready(); const deleting = await beginDelete(world);
    assert.equal((await selected(world.page))?.sessionId, ""); assert.equal(firstCount(world), 0);
    world.fail(deleting, "DELETE_REJECTED"); await waitSelected(world.page, "a");
    await world.page.waitForTimeout(100); assert.equal(firstCount(world), 0, "rollback keeps the still-valid summary");
  } },
  { name: "uncertain-delete", run: async world => {
    world.add(session("a"), true); world.firstValue = world.add(session("verified-first")); await world.ready();
    const deleting = await beginDelete(world); world.fail(deleting, "UNCERTAIN");
    await world.page.getByRole("button", { name: "核实结果", exact: true }).waitFor();
    world.invalidate(); await world.page.waitForTimeout(100); assert.equal(firstCount(world), 0, "uncertain delete still blocks pre-commit first");
    await world.page.getByRole("button", { name: "核实结果", exact: true }).click();
    await until(() => world.commands.some(c => c.op === "request.get"), "read-only not_found verification");
    assert.equal(firstCount(world), 0, "not_found while stopping is not completion");
    world.sessions.delete("w:a"); world.lists.set("w", []); world.publish("sessions:w"); world.invalidate();
    world.verification = { status: "committed" };
    await world.page.getByRole("button", { name: "核实结果", exact: true }).click(); await waitSelected(world.page, "verified-first");
    assert.equal(world.commands.filter(c => c.op === "request.get").length, 2);
    assert.equal(world.commands.filter(c => c.op === "session.delete").length, 1, "verification must never replay the write");
  } },
  { name: "workspace-rollback", view: { workspaceId: "foreign", sessionId: "a" }, run: async world => {
    world.workspaces.unshift(workspace("extra")); world.add(session("a", "foreign"));
    world.firstValue = world.add(session("automatic-first")); await world.ready();
    const afterBegin = await world.page.evaluate(() => {
      void (window as any).sessionSelection.command("workspace.delete", { confirmed: true }, { workspaceId: "foreign" }, "delete-workspace").catch(() => {});
      return { view: JSON.parse(sessionStorage.getItem("view")!), sidebar: sessionStorage.getItem("sidebarWorkspaceId") };
    });
    assert.deepEqual(afterBegin, { view: { workspaceId: "w", sessionId: "" }, sidebar: "w" }, "keep the valid sidebar, not the first remaining workspace or cached session");
    await waitSelected(world.page, "automatic-first"); await until(() => world.pendingWrites.get("delete-workspace"), "workspace deletion dispatched");
    world.fail(world.pendingWrites.get("delete-workspace")!, "WORKSPACE_REJECTED");
    await waitSelected(world.page, "a", "foreign");
    assert.equal(await world.page.evaluate(() => sessionStorage.getItem("sidebarWorkspaceId")), "w", "automatic first did not disown delete rollback");
  } },
  { name: "new-wins-delete", run: async world => {
    world.add(session("a"), true); await world.ready(); const deleting = await beginDelete(world);
    await world.page.locator("#new-chat").click(); await world.page.locator("#prompt").fill("preparation draft survives");
    await world.page.locator("#new-chat").click();
    await until(() => pendingWrite(world, "session.create"), "creation write dispatched");
    assert.equal([...world.pendingWrites.values()].filter(c => c.op === "session.create").length, 1, "duplicate New shares the preparation");
    world.fail(deleting, "LATE_DELETE_REJECTED"); await world.page.waitForTimeout(100);
    assert.equal((await selected(world.page))?.sessionId, "", "New's synchronous intent disowns old delete rollback");
    assert.equal(await world.page.locator("#prompt").inputValue(), "preparation draft survives");
    const created = world.add(session("created-outside")); world.receipt(pendingWrite(world, "session.create")!, created);
    await waitSelected(world.page, created.id); assert.equal(await world.page.locator("#prompt").inputValue(), "preparation draft survives");
    assert.equal(firstCount(world), 0, "neither preparation nor new page-external session needs first");
  } },
  { name: "late-create-selection", run: async world => {
    world.add(session("a"), true); world.add(session("b"), true); await world.ready();
    await world.page.locator("#new-chat").click(); await world.page.locator("#prompt").fill("background creation draft");
    await until(() => pendingWrite(world, "session.create"), "creation write dispatched");
    await world.page.locator('[data-session-id="b"] .history-item').click(); await waitSelected(world.page, "b");
    const created = world.add(session("created-late")); world.receipt(pendingWrite(world, "session.create")!, created);
    await world.page.waitForTimeout(150); assert.equal((await selected(world.page))?.sessionId, "b");
    const draft = await world.page.evaluate(scope => (window as any).sessionSelection.scopeSnapshot(`session:${scope.workspaceId}:${scope.sessionId}`), { workspaceId: "w", sessionId: "b" });
    assert.equal(draft.id, "b"); assert.equal(await world.page.locator("#prompt").inputValue(), "", "late preparation does not overwrite the chosen Composer");
  } },
  { name: "pristine-reuse", run: async world => {
    const pristine = world.add(session("a", "w", { title: "新对话", messageCount: 0 }), true); await world.ready();
    await world.page.locator("#prompt").fill("mounted pristine draft");
    await world.page.evaluate(() => { (window as any).originalPrompt = document.getElementById("prompt"); });
    await world.page.locator("#new-chat").click(); await world.page.locator("#new-chat").click();
    await until(() => pendingWrite(world, "session.create"), "reuseEmpty dispatched");
    assert.equal(await world.page.evaluate(() => (window as any).originalPrompt === document.getElementById("prompt")), true);
    assert.equal(await world.page.locator("#prompt").inputValue(), "mounted pristine draft");
    assert.equal([...world.pendingWrites.values()].filter(c => c.op === "session.create").length, 1);
    world.receipt(pendingWrite(world, "session.create")!, pristine); await world.page.waitForTimeout(100);
    assert.equal(await world.page.evaluate(() => (window as any).originalPrompt === document.getElementById("prompt")), true);
    assert.equal(await world.page.locator("#prompt").inputValue(), "mounted pristine draft");
  } },
  { name: "unknown-count-preview", run: async world => {
    world.add(session("a", "w", { title: "新对话", messageCount: undefined }));
    world.lists.set("w", [session("a", "w", { title: "新对话", messageCount: 0 })]); await world.ready();
    await world.page.locator("#prompt").fill("original draft");
    await world.page.evaluate(() => { (window as any).originalPrompt = document.getElementById("prompt"); });
    await world.page.locator("#new-chat").click(); await until(() => pendingWrite(world, "session.create"), "unknown count creation dispatched");
    assert.equal(await world.page.evaluate(() => (window as any).originalPrompt === document.getElementById("prompt")), false, "a stale list count zero cannot prove current pristine reuse");
    await world.page.locator("#prompt").fill("new preparation draft");
    const created = world.add(session("unknown-created", "w", { title: "新对话", messageCount: 0 }));
    world.receipt(pendingWrite(world, "session.create")!, created); await waitSelected(world.page, created.id);
    assert.equal(await world.page.locator("#prompt").inputValue(), "new preparation draft");
  } },
  { name: "late-first-selection", run: async world => {
    world.add(session("b"), true); const foreign = world.add(session("foreign-picked", "foreign", { pinned: true })); world.pinned = [foreign];
    world.holdFirst = true; const fallback = world.add(session("obsolete-first")); await world.ready();
    await until(() => world.pendingFirst.length, "first read pending"); const old = world.pendingFirst.at(-1)!;
    await world.page.locator('[data-session-id="foreign-picked"] .history-item').click(); await waitSelected(world.page, foreign.id, "foreign");
    world.receipt(old, fallback); await world.page.waitForTimeout(100);
    assert.deepEqual(await selected(world.page), { workspaceId: "foreign", sessionId: foreign.id }, "late fallback cannot overwrite a user cross-workspace choice");
  } },
  { name: "same-revision-first", run: async world => {
    world.holdFirst = true; const obsolete = world.add(session("obsolete-first")), fresh = world.add(session("fresh-first")); await world.ready();
    await until(() => world.pendingFirst.length, "first read pending"); const old = world.pendingFirst.at(-1)!, before = firstCount(world);
    world.publish("session-list"); await until(() => firstCount(world) > before, "new delivery with unchanged revision supersedes first");
    world.receipt(old, obsolete); await world.page.waitForTimeout(100); assert.equal((await selected(world.page))?.sessionId, "a");
    world.receipt(world.pendingFirst.at(-1)!, fresh); await waitSelected(world.page, fresh.id);
  } },
  { name: "reconnect-first", run: async world => {
    world.holdFirst = true; const fresh = world.add(session("after-reconnect")); await world.ready();
    await until(() => world.pendingFirst.length, "old connection first pending"); const old = world.pendingFirst.at(-1)!, before = firstCount(world);
    world.mutedScopes.add("session-list"); world.mutedScopes.add("session:w:a"); world.socket.close({ code: 1012, reason: "synthetic reconnect" });
    await until(() => world.sockets.length > 1, "replacement socket opened"); await world.page.waitForTimeout(150);
    assert.equal(firstCount(world), before, "old global/summary cache is not replacement authority");
    world.mutedScopes.delete("session-list"); world.publish("session-list"); await world.page.waitForTimeout(100);
    assert.equal(firstCount(world), before, "fresh global alone cannot revive an old null summary");
    world.mutedScopes.delete("session:w:a"); world.publish("session:w:a"); await until(() => firstCount(world) > before, "fresh summary enables replacement first");
    world.receipt(old, fresh); await world.page.waitForTimeout(50); assert.equal((await selected(world.page))?.sessionId, "a");
    world.receipt(world.pendingFirst.at(-1)!, fresh); await waitSelected(world.page, fresh.id);
  } },
  { name: "guarded-first", run: async world => {
    world.add(session("a"), true); const obsolete = world.add(session("guard-obsolete")); world.holdFirst = true; await world.ready();
    await world.page.evaluate(() => (window as any).sessionSelection.setFileDirty(true));
    world.sessions.delete("w:a"); world.publish("session:w:a"); world.invalidate();
    await until(() => world.pendingFirst.length, "first after real null"); world.receipt(world.pendingFirst.at(-1)!, obsolete);
    await world.page.getByRole("dialog", { name: "放弃未保存的文件编辑？" }).waitFor();
    world.add(session("a")); world.publish("session:w:a"); await settle(world.page);
    await world.page.getByRole("button", { name: "放弃修改", exact: true }).click(); await world.page.waitForTimeout(100);
    assert.equal((await selected(world.page))?.sessionId, "a", "guard-confirmation execution rechecks the authority, not only RPC completion");
    await world.page.evaluate(() => (window as any).sessionSelection.setFileDirty(false));
  } },
  { name: "fork-outside-list", run: async world => {
    world.add(session("a"), true); world.messages.set("w:a", [{ id: "answer", role: "assistant", phase: "final_answer", status: "completed", text: "Synthetic completed answer." }]);
    await world.ready(); await world.page.getByText("Synthetic completed answer.", { exact: true }).hover();
    await world.page.getByRole("button", { name: "从此处创建分支", exact: true }).click();
    await world.page.getByRole("button", { name: "仅创建", exact: true }).click();
    await until(() => pendingWrite(world, "agent.fork"), "background fork dispatched"); const background = pendingWrite(world, "agent.fork")!;
    world.receipt(background, world.add(session("background-fork"))); await world.page.getByRole("dialog", { name: "创建分支会话" }).waitFor({ state: "hidden" });
    assert.equal((await selected(world.page))?.sessionId, "a", "background fork does not navigate");
    world.pendingWrites.delete(background.requestId);
    await world.page.getByText("Synthetic completed answer.", { exact: true }).hover();
    await world.page.getByRole("button", { name: "从此处创建分支", exact: true }).click();
    await world.page.getByRole("button", { name: "创建并打开", exact: true }).click(); await until(() => pendingWrite(world, "agent.fork"), "open fork dispatched");
    const child = world.add(session("opened-fork", "w", { forkParentSessionId: "a" })); world.receipt(pendingWrite(world, "agent.fork")!, child);
    await waitSelected(world.page, child.id); await world.page.waitForTimeout(100); assert.equal(firstCount(world), 0);
    assert.equal(world.commands.filter(c => c.op === "agent.fork").length, 2);
  } },
];

try {
  await vite.listen();
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const requested = process.env.AXIOM_SESSION_SELECTION_CASES?.split(",").filter(Boolean);
  const enabled = requested ? cases.filter(item => requested.includes(item.name)) : cases;
  assert.ok(enabled.length && (!requested || enabled.length === requested.length), "all requested scenario names must exist");
  for (const scenario of enabled) {
    const page: Page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.stack ?? error.message));
    const port = (vite.httpServer!.address() as { port: number }).port;
    const world: World = new World(page, scenario.view ?? { workspaceId: "w", sessionId: "a" }, `http://127.0.0.1:${port}`);
    await world.install();
    try {
      await scenario.run(world); assert.deepEqual(errors, []); assert.deepEqual(world.unexpected, []);
      reports.push({ name: scenario.name, passed: true, selected: await selected(page), commands: world.commands, errors });
      console.log(`PASS ${scenario.name}`);
    } catch (error) {
      reports.push({ name: scenario.name, passed: false, error: String(error), selected: await selected(page).catch(() => null), commands: world.commands, errors, unexpected: world.unexpected });
      await page.screenshot({ path: join(artifacts, `${scenario.name}.png`), fullPage: true }).catch(() => {});
      writeFileSync(join(artifacts, `${scenario.name}.html`), await page.content().catch(() => ""));
      throw error;
    } finally { await page.close(); }
  }
  console.log(`PASS session-selection ${enabled.length} cases; artifacts ${artifacts}`);
} finally {
  writeFileSync(join(artifacts, "report.json"), JSON.stringify(reports, null, 2));
  await browser?.close(); await vite.close(); rmSync(temporary, { recursive: true, force: true });
}
