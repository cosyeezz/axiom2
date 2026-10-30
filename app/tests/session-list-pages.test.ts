import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/shared/protocol.js";
import type { SessionListCursor, SessionListGroup, SessionListInitial, SessionListPage } from "../src/shared/session-list.js";
import { SessionListPages, type SessionListReader } from "../src/client/workspaces/session-list-pages.js";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
type Held = {
  op: "initial" | "page"; workspaceId: string; query: string; signal: AbortSignal;
  group?: SessionListGroup; cursor?: SessionListCursor | null;
  resolve(value: SessionListInitial | SessionListPage): void; reject(error: unknown): void;
};
function harness(workspaceId = "workspace-a", query = "  É/ß  ", continuous = false) {
  const calls: Held[] = [];
  const hold = <T extends SessionListInitial | SessionListPage>(args: Omit<Held, "resolve" | "reject">) =>
    new Promise<T>((resolve, reject) => calls.push({ ...args, resolve: value => resolve(value as T), reject }));
  const reader: SessionListReader = {
    initial: (workspaceId, query, signal) => hold<SessionListInitial>({ op: "initial", workspaceId, query, signal }),
    page: (workspaceId, group, query, cursor, signal) => hold<SessionListPage>({ op: "page", workspaceId, group, query, cursor, signal }),
  };
  const model = new SessionListPages(reader, workspaceId, query, continuous);
  const cursor = (group: SessionListGroup, offset: number, revision = 1): SessionListCursor =>
    ({ version: 1, streamId: "stream-a", revision, workspaceId, query, group, familyRank: offset, memberRank: offset });
  const page = (group: SessionListGroup, offset = 0, revision = 1, count = 30, next = true): SessionListPage => ({
    revision, next: next ? cursor(group, offset + count, revision) : null,
    items: Array.from({ length: count }, (_, i) => ({
      id: `${group}-${offset + i}`, workspaceId: group === "top" && i % 2 ? "foreign" : workspaceId,
      title: `title-${count - i}`, pinned: false, unread: i % 2 === 0, updatedAt: 100 + i,
      forkParentSessionId: `${group}-parent-outside-this-page`, familyId: `family-${group}-${Math.floor((offset + i) / 3)}`, familyTop: group === "top",
    })),
  });
  const initial = (revision = 1): SessionListInitial => ({ revision, top: page("top", 0, revision), workspace: page("workspace", 0, revision) });
  const ready = async (revision = 1) => {
    const pending = model.refresh(); await tick(); calls.at(-1)!.resolve(initial(revision)); await pending;
  };
  return { model, calls, cursor, page, initial, ready };
}

test("two bounded pages preserve server family/order and navigate with cursor metadata only", { timeout: 2000 }, async t => {
  const h = harness(); t.after(() => h.model.dispose());
  const empty = h.model.getSnapshot();
  assert.equal(empty.revision, null); assert.equal(empty.top.page, null); assert.equal(empty.workspace.page, null);
  await h.model.next("top"); await h.model.previous("workspace"); assert.equal(h.calls.length, 0);
  await h.ready();
  assert.equal(h.calls[0].workspaceId, "workspace-a"); assert.equal(h.calls[0].query, "  É/ß  ");
  const first = h.model.getSnapshot(), firstWorkspace = first.workspace.page!;
  assert.equal(first.top.page!.items.length, 30); assert.equal(firstWorkspace.items.length, 30);
  assert.equal(firstWorkspace.items[0].messageCount, undefined);
  const next = h.model.next("workspace"), duplicate = h.model.next("workspace");
  await duplicate; assert.equal(h.calls.length, 2); assert.deepEqual(h.calls[1].cursor, firstWorkspace.next);
  const second = h.page("workspace", 30); h.calls[1].resolve(second); await next;
  assert.equal(h.model.getSnapshot().top, first.top);
  assert.equal(h.model.getSnapshot().workspace.page, second);
  assert.deepEqual(h.model.getSnapshot().workspace.previous, [null]);
  const final = h.model.next("workspace"); const third = h.page("workspace", 60, 1, 6, false);
  h.calls[2].resolve(third); await final;
  assert.equal(h.model.getSnapshot().workspace.page!.items.length, 6);
  assert.deepEqual(h.model.getSnapshot().workspace.previous, [null, firstWorkspace.next]);
  await h.model.next("workspace"); assert.equal(h.calls.length, 3);
  const previous = h.model.previous("workspace"); assert.deepEqual(h.calls[3].cursor, firstWorkspace.next);
  h.calls[3].resolve(second); await previous;
  assert.equal(h.model.getSnapshot().workspace.page, second);
  const home = h.model.previous("workspace"); assert.equal(h.calls[4].cursor, null);
  h.calls[4].resolve(firstWorkspace); await home;
  assert.deepEqual(h.model.getSnapshot().workspace.previous, []);
  assert.equal(h.model.getSnapshot().workspace.page, firstWorkspace);
  assert.deepEqual(firstWorkspace.items.map(row => [row.id, row.familyId, row.familyTop]),
    h.page("workspace").items.map(row => [row.id, row.familyId, row.familyTop]));
});

test("initial invalidation bursts coalesce, dirty follow-ups are not lost, and equal revisions refresh counts", { timeout: 2000 }, async t => {
  const h = harness(); t.after(() => h.model.dispose());
  const pending = h.model.refresh(); await tick();
  for (let i = 0; i < 20; i++) assert.equal(h.model.refresh(), pending);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].signal.aborted, false);
  h.calls[0].resolve(h.initial(1)); await tick();
  assert.equal(h.calls.length, 2); assert.equal(h.model.getSnapshot().revision, 1);
  assert.equal(h.model.getSnapshot().loading, true); // usable coherent first result, not starvation
  for (let i = 0; i < 20; i++) void h.model.refresh();
  h.calls[1].resolve(h.initial(2)); await tick();
  assert.equal(h.calls.length, 3);
  h.calls[2].resolve(h.initial(2)); await pending;
  assert.equal(h.model.getSnapshot().loading, false);
  const sameRevision = h.model.refresh(); await tick();
  const counted = h.initial(2); counted.workspace.items[0].messageCount = 7;
  h.calls[3].resolve(counted); await sameRevision;
  assert.equal(h.model.getSnapshot().revision, 2);
  assert.equal(h.model.getSnapshot().workspace.page!.items[0].messageCount, 7);
  assert.equal(h.calls.length, 4);
});

test("independent groups commit in reverse order and refresh rejects both obsolete page outcomes", { timeout: 2000 }, async t => {
  const h = harness(); t.after(() => h.model.dispose()); await h.ready();
  const nextTop = h.model.next("top"), nextWorkspace = h.model.next("workspace");
  assert.deepEqual(h.calls.slice(1).map(call => call.group), ["top", "workspace"]);
  const workspacePage = h.page("workspace", 30); h.calls[2].resolve(workspacePage); await nextWorkspace;
  assert.equal(h.model.getSnapshot().workspace.page, workspacePage);
  assert.equal(h.model.getSnapshot().top.loading, true);
  const topPage = h.page("top", 30); h.calls[1].resolve(topPage); await nextTop;
  assert.equal(h.model.getSnapshot().top.page, topPage);
  const obsoleteTop = h.model.previous("top"), obsoleteWorkspace = h.model.previous("workspace");
  const fresh = h.model.refresh(); await tick();
  assert.equal(h.calls[3].signal.aborted, true); assert.equal(h.calls[4].signal.aborted, true);
  h.calls[5].resolve(h.initial(2)); await fresh;
  const stable = h.model.getSnapshot(); let notifications = 0;
  h.model.subscribe(() => { notifications++; });
  h.calls[3].resolve(h.page("top")); h.calls[4].reject(new AppError("CURSOR_STALE", "old error"));
  await Promise.all([obsoleteTop, obsoleteWorkspace]);
  assert.equal(h.model.getSnapshot(), stable); assert.equal(notifications, 0); assert.equal(h.calls.length, 6);
});

test("CURSOR_STALE resets both groups and an older group's finally cannot clear a newer request", { timeout: 2000 }, async t => {
  const h = harness(); t.after(() => h.model.dispose()); await h.ready();
  const oldTop = h.model.next("top"), stale = h.model.next("workspace");
  h.calls[2].reject(new AppError("CURSOR_STALE", "metadata changed")); await tick();
  assert.equal(h.calls[3].op, "initial"); assert.equal(h.calls[1].signal.aborted, true);
  assert.equal(h.model.getSnapshot().top.page!.revision, 1);
  assert.equal(h.model.getSnapshot().workspace.page!.revision, 1);
  h.calls[3].resolve(h.initial(2)); await stale;
  const currentTop = h.model.next("top");
  h.calls[1].reject(new Error("late failure from old batch")); await oldTop;
  assert.equal(h.model.getSnapshot().top.loading, true);
  h.calls[4].resolve(h.page("top", 30, 2)); await currentTop;
  assert.deepEqual(h.model.getSnapshot().top.previous, [null]);
  assert.deepEqual(h.model.getSnapshot().workspace.previous, []);
  assert.equal(h.model.getSnapshot().workspace.page!.revision, 2);
});

test("a previous-first-page response with a new revision never mixes one new group into an old batch", { timeout: 2000 }, async t => {
  const h = harness(); t.after(() => h.model.dispose()); await h.ready();
  const next = h.model.next("workspace"); h.calls[1].resolve(h.page("workspace", 30)); await next;
  const old = h.model.getSnapshot(), previous = h.model.previous("workspace");
  assert.equal(h.calls[2].cursor, null); h.calls[2].resolve(h.page("workspace", 0, 2)); await tick();
  assert.equal(h.calls[3].op, "initial");
  assert.equal(h.model.getSnapshot().revision, 1);
  assert.equal(h.model.getSnapshot().top.page, old.top.page);
  assert.equal(h.model.getSnapshot().workspace.page, old.workspace.page);
  h.calls[3].resolve(h.initial(2)); await previous;
  assert.equal(h.model.getSnapshot().top.page!.revision, 2);
  assert.equal(h.model.getSnapshot().workspace.page!.revision, 2);
  assert.deepEqual(h.model.getSnapshot().workspace.previous, []);
});

test("ordinary initial/page failures retain data and cursor position and allow explicit retry", { timeout: 2000 }, async t => {
  const h = harness(); t.after(() => h.model.dispose());
  const first = h.model.refresh(); await tick(); const failure = new Error("unavailable");
  h.calls[0].reject(failure); await first;
  assert.equal(h.model.getSnapshot().error, failure); assert.equal(h.model.getSnapshot().workspace.page, null);
  await h.ready(); const original = h.model.getSnapshot();
  for (const code of ["CANCELLED", "UNCERTAIN", "OTHER_READ_FAILURE"]) {
    const next = h.model.next("workspace"), call = h.calls.at(-1)!; call.reject(new AppError(code, code)); await next;
    assert.equal(h.model.getSnapshot().workspace.page, original.workspace.page);
    assert.equal(h.model.getSnapshot().workspace.cursor, null);
    assert.deepEqual(h.model.getSnapshot().workspace.previous, []);
    assert.equal(h.model.getSnapshot().workspace.loading, false);
    assert.equal((h.model.getSnapshot().workspace.error as AppError).code, code);
    assert.deepEqual(call.cursor, original.workspace.page!.next);
    assert.equal(h.calls.filter(call => call.op === "initial").length, 2);
  }
  const retry = h.model.next("workspace"); h.calls.at(-1)!.resolve(h.page("workspace", 30)); await retry;
  assert.equal(h.model.getSnapshot().workspace.error, null); assert.equal(h.model.getSnapshot().workspace.previous.length, 1);
});

test("malformed initial snapshots cannot replace a coherent batch with mixed revisions or more than 30 rows", { timeout: 2000 }, async t => {
  const h = harness(); t.after(() => h.model.dispose()); await h.ready();
  const original = h.model.getSnapshot();
  const mixed = h.initial(2); mixed.workspace = h.page("workspace", 0, 3);
  const oversized = h.initial(2); oversized.top = h.page("top", 0, 2, 31);
  const wrongContext = h.initial(2); wrongContext.workspace.next = { ...wrongContext.workspace.next!, query: "trimmed" };
  for (const invalid of [mixed, oversized, wrongContext]) {
    const pending = h.model.refresh(); await tick(); h.calls.at(-1)!.resolve(invalid); await pending;
    assert.equal(h.model.getSnapshot().revision, 1);
    assert.equal(h.model.getSnapshot().top.page, original.top.page);
    assert.equal(h.model.getSnapshot().workspace.page, original.workspace.page);
    assert.equal((h.model.getSnapshot().error as AppError).code, "INVALID_SESSION_PAGE");
    assert.equal(h.model.getSnapshot().loading, false);
  }
});

test("disposed context or connection lifetimes abort reads and ignore non-cooperative late results", { timeout: 2000 }, async t => {
  for (const [workspaceId, query] of [["workspace-b", "another query"], ["workspace-a", "  É/ß  "]]) {
    const old = harness(), fresh = harness(workspaceId, query); t.after(() => { old.model.dispose(); fresh.model.dispose(); });
    const pending = old.model.refresh(); await tick(); let notifications = 0;
    old.model.subscribe(() => { notifications++; }); old.model.dispose();
    const stable = old.model.getSnapshot(); assert.equal(old.calls[0].signal.aborted, true);
    await fresh.ready(2); const current = fresh.model.getSnapshot();
    old.calls[0].resolve(old.initial()); await pending; await old.model.refresh();
    assert.equal(old.model.getSnapshot(), stable); assert.equal(notifications, 0); assert.equal(old.calls.length, 1);
    assert.equal(fresh.model.getSnapshot(), current); assert.equal(fresh.calls[0].workspaceId, workspaceId); assert.equal(fresh.calls[0].query, query);
    const page = fresh.model.next("workspace"); fresh.model.dispose(); const disposed = fresh.model.getSnapshot();
    assert.equal(fresh.calls[1].signal.aborted, true); fresh.calls[1].reject(new AppError("CURSOR_STALE", "late")); await page;
    assert.equal(fresh.model.getSnapshot(), disposed); assert.equal(fresh.calls.length, 2);
  }
});

test("reentrant invalidation shares the real refresh promise and disposal suppresses its dirty follow-up", { timeout: 2000 }, async t => {
  const h = harness(); t.after(() => h.model.dispose()); let reentrant: Promise<void> | undefined, armed = true;
  h.model.subscribe(() => { if (armed) { armed = false; reentrant = h.model.refresh(); } });
  const pending = h.model.refresh(); assert.equal(reentrant, pending); await tick();
  let completed = false; void reentrant!.then(() => { completed = true; });
  await tick(); assert.equal(completed, false); // not a placeholder promise
  h.calls[0].resolve(h.initial()); await pending; await tick(); assert.equal(h.calls.length, 2);
  assert.equal(completed, true); // do not retain an unbounded dirty-refresh promise chain
  assert.equal(h.model.getSnapshot().loading, true);
  const followUp = h.calls[1]; followUp.resolve(h.initial(2)); await tick();
  h.model.subscribe(() => { if (h.model.getSnapshot().revision === 3) h.model.dispose(); });
  const final = h.model.refresh(); await tick(); void h.model.refresh(); h.calls[2].resolve(h.initial(3)); await final;
  assert.equal(h.calls.length, 3); assert.equal(h.calls[2].signal.aborted, true);
});

test("page reentrancy during loading refreshes or disposes before invoking the obsolete reader", { timeout: 2000 }, async t => {
  for (const action of ["refresh", "dispose"] as const) {
    const h = harness(); t.after(() => h.model.dispose()); await h.ready();
    let armed = true, followUp: Promise<void> | undefined;
    h.model.subscribe(() => {
      if (!armed || !h.model.getSnapshot().workspace.loading) return;
      armed = false;
      if (action === "refresh") followUp = h.model.refresh(); else h.model.dispose();
    });
    await h.model.next("workspace"); await tick();
    assert.equal(h.calls.filter(call => call.op === "page").length, 0);
    if (action === "refresh") {
      assert.ok(followUp); assert.equal(h.calls.length, 2);
      h.calls[1].resolve(h.initial(2)); await followUp;
      assert.equal(h.model.getSnapshot().workspace.loading, false);
      assert.equal(h.model.getSnapshot().revision, 2);
    } else assert.equal(h.calls.length, 1);
  }
});

test("page reentrancy after success preserves a newer same-epoch request across the old finally", { timeout: 2000 }, async t => {
  const h = harness(); t.after(() => h.model.dispose()); await h.ready();
  let armed = true, followUp: Promise<void> | undefined;
  h.model.subscribe(() => {
    const frame = h.model.getSnapshot().workspace;
    if (armed && !frame.loading && frame.page?.items[0].id === "workspace-30") {
      armed = false; followUp = h.model.next("workspace");
    }
  });
  const next = h.model.next("workspace"); h.calls[1].resolve(h.page("workspace", 30)); await next;
  assert.ok(followUp); assert.equal(h.calls.length, 3); assert.equal(h.model.getSnapshot().workspace.loading, true);
  const final = h.page("workspace", 60, 1, 4, false); h.calls[2].resolve(final); await followUp;
  assert.equal(h.model.getSnapshot().workspace.page, final);
  assert.equal(h.model.getSnapshot().workspace.loading, false);
  assert.equal(h.model.getSnapshot().workspace.previous.length, 2);
});

test("continuous next appends in server order without replacing existing rows or duplicating requests", async t => {
  const h = harness("workspace-a", "", true); t.after(() => h.model.dispose()); await h.ready();
  const first = h.model.getSnapshot().workspace.page!.items;
  const next = h.model.next("workspace"); await h.model.next("workspace");
  assert.equal(h.calls.length, 2); assert.equal(h.model.getSnapshot().workspace.page!.items, first);
  h.calls[1].resolve(h.page("workspace", 30)); await next;
  const second = h.model.getSnapshot().workspace.page!.items;
  assert.equal(second.length, 60); assert.deepEqual(second.slice(0, 30), first);
  assert.equal(second[0], first[0]); assert.deepEqual(h.model.getSnapshot().workspace.previous, []);
  const last = h.model.next("workspace"); h.calls[2].resolve(h.page("workspace", 60, 1, 5, false)); await last;
  assert.equal(h.model.getSnapshot().workspace.page!.items.length, 65);
  assert.equal(h.model.getSnapshot().workspace.page!.items[64].id, "workspace-64");
  await h.model.next("workspace"); assert.equal(h.calls.length, 3);
});

test("continuous background refresh preserves displayed depth and atomically replaces one revision", async t => {
  const h = harness("workspace-a", "", true); t.after(() => h.model.dispose()); await h.ready();
  const next = h.model.next("workspace"); h.calls[1].resolve(h.page("workspace", 30)); await next;
  const old = h.model.getSnapshot(); const refresh = h.model.refresh(); await tick();
  h.calls[2].resolve(h.initial(2)); await tick();
  assert.equal(h.calls.length, 4); assert.equal(h.calls[3].group, "workspace");
  assert.equal(h.model.getSnapshot().workspace.page, old.workspace.page);
  assert.equal(h.model.getSnapshot().top.page, old.top.page);
  assert.equal(h.model.getSnapshot().revision, 1);
  h.calls[3].resolve(h.page("workspace", 30, 2)); await refresh;
  const fresh = h.model.getSnapshot();
  assert.equal(fresh.workspace.page!.items.length, 60); assert.equal(fresh.revision, 2);
  assert.equal(fresh.top.page!.revision, 2); assert.equal(fresh.workspace.page!.revision, 2);
  assert.equal(fresh.loading, false);
});

test("continuous overlapping items are deduplicated by workspace and id without reordering", async t => {
  const h = harness("workspace-a", "", true); t.after(() => h.model.dispose()); await h.ready();
  const next = h.model.next("workspace"), page = h.page("workspace", 30);
  page.items[0] = { ...page.items[0], id: "workspace-29", title: "updated overlap" };
  h.calls[1].resolve(page); await next;
  const rows = h.model.getSnapshot().workspace.page!.items;
  assert.equal(rows.length, 59); assert.equal(new Set(rows.map(row => row.id)).size, 59);
  assert.equal(rows[29].id, "workspace-29"); assert.equal(rows[29].title, "updated overlap");
  assert.equal(rows[30].id, "workspace-31");
});

test("continuous stalled cursors fail without losing rows and allow an explicit retry", async t => {
  const h = harness("workspace-a", "", true); t.after(() => h.model.dispose()); await h.ready();
  const original = h.model.getSnapshot().workspace.page!;
  const next = h.model.next("workspace"), stalled = h.page("workspace", 30);
  stalled.next = original.next; h.calls[1].resolve(stalled); await next;
  assert.equal(h.model.getSnapshot().workspace.page, original);
  assert.equal((h.model.getSnapshot().workspace.error as AppError).code, "INVALID_SESSION_PAGE");
  const retry = h.model.next("workspace"); h.calls[2].resolve(h.page("workspace", 30)); await retry;
  assert.equal(h.model.getSnapshot().workspace.page!.items.length, 60);
  assert.equal(h.model.getSnapshot().workspace.error, null);
});

test("continuous refresh disposal aborts depth rebuilding and ignores its late result", async t => {
  const h = harness("workspace-a", "", true); t.after(() => h.model.dispose()); await h.ready();
  const next = h.model.next("workspace"); h.calls[1].resolve(h.page("workspace", 30)); await next;
  const refresh = h.model.refresh(); await tick(); h.calls[2].resolve(h.initial(2)); await tick();
  assert.equal(h.calls.length, 4); h.model.dispose(); const stable = h.model.getSnapshot();
  assert.equal(h.calls[3].signal.aborted, true); h.calls[3].resolve(h.page("workspace", 30, 2)); await refresh;
  assert.equal(h.model.getSnapshot(), stable); assert.equal(h.model.getSnapshot().revision, 1);
});
