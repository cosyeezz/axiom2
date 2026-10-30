import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { SessionLists } from "../src/server/session-list.js";
import { Store } from "../src/server/storage.js";
import { sessionFamilies } from "../src/client/workspaces/session-order.js";
import { isTopSession } from "../src/shared/session-attention.js";
import type { Session } from "../src/shared/protocol.js";
import type { SessionListCursor, SessionListGroup, SessionListItem } from "../src/shared/session-list.js";

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "axiom-session-list-"));
  const store = new Store(join(root, "data"));
  const connections: DatabaseSync[] = [];
  t.after(() => {
    try { for (const connection of connections) connection.close(); }
    finally { try { store.close(); } finally { rmSync(root, { recursive: true, force: true }); } }
  });
  const workspaces = ["main", "other", "archived"].map(name => {
    const path = join(root, name); mkdirSync(path);
    return store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path, authorized: true } }) as { id: string };
  });
  const [workspace, foreign, archived] = workspaces.map(row => row.id);
  store.db.prepare("UPDATE workspaces SET archived=1 WHERE id=?").run(archived);
  const lists = new SessionLists(store, "test-stream");
  const insert = store.db.prepare(`INSERT INTO sessions
    (id,workspaceId,title,pinned,unread,updatedAt,forkParentSessionId,autoPinUntil,resultVersion)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  let time = 1000;
  const add = (row: Partial<Session> = {}) => {
    const id = row.id ?? randomUUID();
    insert.run(id, row.workspaceId ?? workspace, row.title ?? "match", Number(!!row.pinned), Number(!!row.unread),
      row.updatedAt ?? time++, row.forkParentSessionId ?? null, row.autoPinUntil ?? null, row.unread ? 1 : 0);
    return id;
  };
  const openConnection = () => {
    const connection = new DatabaseSync(join(store.root, "axiom.sqlite"));
    connections.push(connection);
    return connection;
  };
  return { store, lists, workspace, foreign, archived, add, openConnection };
}
type Fixture = ReturnType<typeof fixture>;

function reference(f: Fixture, group: SessionListGroup, query = "") {
  const byId = new Map([...f.store.sessions(f.workspace), ...f.store.pinnedSessions()].map(row => [row.id, row]));
  return sessionFamilies([...byId.values()].filter(row => row.title.toLowerCase().includes(query.toLowerCase())))
    .filter(family => family.some(isTopSession) === (group === "top"))
    .flatMap(family => family.map(row => ({ id: row.id, familyId: family[0].id, familyTop: group === "top" })));
}
function all(f: Fixture, group: SessionListGroup, query = "") {
  const rows: SessionListItem[] = [];
  let cursor: SessionListCursor | null = null, pages = 0;
  do {
    const page = f.lists.page(f.workspace, group, query, cursor);
    assert.ok(page.items.length <= 30);
    rows.push(...page.items); cursor = page.next;
    assert.ok(++pages < 100, "cursor must advance");
  } while (cursor);
  return rows;
}
const identity = (row: SessionListItem) => ({ id: row.id, familyId: row.familyId, familyTop: row.familyTop });
const code = (value: string) => (error: unknown) => (error as { code?: string }).code === value;

test("pages preserve the full forest order, split large families, and keep foreign candidates and search semantics", t => {
  const f = fixture(t);
  const root = f.add({ title: "match root", updatedAt: 1 });
  for (let i = 0; i < 77; i++) {
    const child = f.add({ forkParentSessionId: root, pinned: i === 65 });
    if (i === 10) f.add({ forkParentSessionId: child, title: "match nested" });
  }
  for (let i = 0; i < 67; i++) f.add({ title: i % 2 ? "ÉLAN" : "ordinary match" });
  const foreignParent = f.add({ workspaceId: f.foreign, pinned: true });
  const foreignOrdinary = f.add({ workspaceId: f.foreign, forkParentSessionId: foreignParent });
  f.add({ workspaceId: f.foreign, forkParentSessionId: foreignParent, unread: true });
  f.add({ workspaceId: f.archived, pinned: true });
  f.add({ title: "İstanbul" });
  const hiddenTop = f.add({ title: "hidden parent", pinned: true });
  const onlyMatch = f.add({ forkParentSessionId: hiddenTop, title: "only child" });
  for (const query of ["", "match", "él", "i̇s", "only", " match"]) {
    for (const group of ["top", "workspace"] as const) {
      assert.deepEqual(all(f, group, query).map(identity), reference(f, group, query), `${group} query=${JSON.stringify(query)}`);
    }
  }
  const top = all(f, "top");
  assert.equal(top.find(row => row.id === root)?.familyId, root);
  assert.equal(top.filter(row => row.familyId === root).length, 79, "one family continues across more than two pages");
  assert.ok(!top.some(row => row.id === foreignOrdinary), "do not expand foreign ordinary relatives");
  assert.equal(all(f, "workspace", "only")[0]?.id, onlyMatch, "nonmatching top cannot propagate into search");
});

test("top pages and fork siblings stay fixed through activity updates, including page boundaries", t => {
  const f = fixture(t);
  const pins = Array.from({ length: 65 }, (_, i) => f.add({ pinned: true, updatedAt: 100 + i }));
  const root = f.add({ pinned: true, updatedAt: 1 });
  const children = Array.from({ length: 35 }, (_, i) => f.add({ forkParentSessionId: root, updatedAt: 2 + i }));
  const ordinary = f.add({ updatedAt: 10000 });
  const baseline = all(f, "top").map(identity);
  const run = f.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt) VALUES(?,?,'running','{}',1)");
  // Touch rows on opposite sides of the 30-row boundary and a formerly idle child.
  for (const id of [pins[0], pins[40], children[0], children[20]]) {
    run.run(id, id);
    f.store.db.prepare("UPDATE sessions SET updatedAt=20000,title='renamed' WHERE id=?").run(id);
    assert.deepEqual(all(f, "top").map(identity), baseline);
    f.store.finishRun(id, "completed", null);
    assert.deepEqual(all(f, "top").map(identity), baseline, "new unread result must not reorder top rows");
    f.store.db.prepare("UPDATE sessions SET unread=0,autoPinUntil=123 WHERE id=?").run(id);
    assert.deepEqual(all(f, "top").map(identity), baseline, "reading/cooling must not reorder the family");
    f.store.db.prepare("UPDATE sessions SET autoPinUntil=0 WHERE id=?").run(id);
    assert.deepEqual(all(f, "top").map(identity), baseline, "a child leaving automatic priority must not move its pinned family");
  }
  assert.deepEqual(all(f, "workspace").map(row => row.id), [ordinary]);
  assert.deepEqual(all(f, "top").map(identity), reference(f, "top"));
  const reconnected = new SessionLists(f.store, "another-stream");
  assert.deepEqual(reconnected.initial(f.workspace).top.items.map(identity), baseline.slice(0, 30));
  assert.equal(reconnected.summary(f.workspace, pins[0])?.title, "renamed", "fresh fields are still published");
});

test("same-time mixed IDs follow the existing stable locale comparison, not SQLite BINARY", t => {
  const f = fixture(t);
  const ids = ["z", "A", "a", "a-1", "a_1", "é", "é", "中", "2", "10", ...Array.from({ length: 40 }, () => randomUUID())];
  for (const id of ids) f.add({ id, updatedAt: 50 });
  assert.deepEqual(all(f, "workspace").map(identity), reference(f, "workspace"));
});

test("broken parent links and unrooted cycle components never hide, duplicate, or mutate rows", t => {
  const f = fixture(t);
  const foreign = f.add({ workspaceId: f.foreign, pinned: true });
  f.add({ id: "missing", forkParentSessionId: "gone" });
  f.add({ id: "cross", forkParentSessionId: foreign });
  f.add({ id: "self", forkParentSessionId: "self" });
  f.add({ id: "cycle-a", forkParentSessionId: "cycle-b" });
  f.add({ id: "cycle-b", forkParentSessionId: "cycle-a" });
  f.add({ id: "inbound", forkParentSessionId: "cycle-a" });
  const child = f.add({ forkParentSessionId: "missing" });
  const before = f.store.db.prepare("SELECT id,forkParentSessionId FROM sessions ORDER BY id").all();
  const rows = all(f, "workspace");
  assert.equal(rows.length, 7); assert.equal(new Set(rows.map(row => row.id)).size, 7);
  for (const id of ["missing", "cross", "self", "cycle-a", "cycle-b", "inbound"]) {
    assert.equal(rows.find(row => row.id === id)?.familyId, id);
  }
  assert.equal(rows.find(row => row.id === child)?.familyId, "missing");
  assert.deepEqual(f.store.db.prepare("SELECT id,forkParentSessionId FROM sessions ORDER BY id").all(), before);
});

test("cursors are strictly bound; metadata revisions roll back atomically and ignore file or usage changes", t => {
  const f = fixture(t);
  for (let i = 0; i < 64; i++) f.add();
  const page = f.lists.page(f.workspace, "workspace", "");
  assert.ok(page.next);
  for (const patch of [{ streamId: "old" }, { revision: page.revision - 1 }, { query: "x" },
    { group: "top" }, { workspaceId: f.foreign }]) {
    assert.throws(() => f.lists.page(f.workspace, "workspace", "", { ...page.next, ...patch }), code("CURSOR_STALE"));
  }
  for (const cursor of [[], "cursor", {}, { ...page.next, familyRank: -1 }, { ...page.next, memberRank: 1.5 },
    { ...page.next, revision: NaN }, { ...page.next, revision: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => f.lists.page(f.workspace, "workspace", "", cursor), code("INVALID_INPUT"));
  }
  const id = page.items[0].id;
  f.store.db.prepare("INSERT INTO agent_sessions(sessionId,file,usage) VALUES(?,?,?)").run(id, "/not-read.jsonl", "{}");
  f.store.db.prepare("UPDATE agent_sessions SET file=?,usage=? WHERE sessionId=?").run("/also-not-read.jsonl", '{"tokens":20}', id);
  assert.equal(f.lists.page(f.workspace, "workspace").revision, page.revision);
  assert.equal(f.lists.page(f.workspace, "workspace", "", page.next).items.length, 30);
  f.store.db.exec("BEGIN");
  f.store.db.prepare("UPDATE sessions SET title=? WHERE id=?").run("uncommitted", id);
  assert.ok(f.lists.page(f.workspace, "workspace").revision > page.revision);
  f.store.db.exec("ROLLBACK");
  assert.equal(f.lists.page(f.workspace, "workspace").revision, page.revision);
  f.store.db.prepare("UPDATE sessions SET pinned=1 WHERE id=?").run(id);
  assert.throws(() => f.lists.page(f.workspace, "workspace", "", page.next), code("CURSOR_STALE"));
  assert.equal(f.lists.page(f.workspace, "top").items[0].id, id);
});

test("selected and first are authoritative outside loaded pages; run, task and workspace changes invalidate summaries", t => {
  const f = fixture(t);
  const parent = f.add({ updatedAt: 1 });
  for (let i = 0; i < 40; i++) f.add();
  assert.ok(!f.lists.page(f.workspace, "workspace").items.some(row => row.id === parent));
  assert.equal(f.lists.summary(f.workspace, parent)?.id, parent);
  assert.equal(f.lists.summary(f.foreign, parent), null);
  assert.equal(f.lists.summary(f.workspace, "absent"), null);
  assert.equal(f.lists.first(f.workspace)?.id, f.store.sessions(f.workspace)[0].id);
  let revision = f.lists.page(f.workspace, "workspace").revision;
  const run = randomUUID();
  f.store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,phase,retry,reasonCode) VALUES(?,?,'running','{}',1,'thinking',?,?)")
    .run(run, parent, '{"state":"waiting"}', "TEST");
  assert.ok(f.lists.page(f.workspace, "top").revision > revision);
  const summary = f.lists.summary(f.workspace, parent)!;
  assert.equal(summary.runId, run); assert.equal(summary.runStatus, "running");
  assert.deepEqual(summary.retry, { state: "waiting" }); assert.equal(summary.reasonCode, "TEST");
  assert.equal(f.lists.page(f.workspace, "top").items[0].id, parent);
  revision = f.lists.page(f.workspace, "top").revision;
  f.store.db.prepare("UPDATE runs SET status='completed',phase=NULL WHERE id=?").run(run);
  assert.ok(f.lists.page(f.workspace, "workspace").revision > revision);
  const child = f.add();
  f.store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,status,budgets,createdAt) VALUES(?,?,?,?,?,'test','queued','{}',1)")
    .run("task", f.workspace, parent, child, "anchor");
  assert.equal(f.lists.summary(f.workspace, parent)?.activeTaskCount, 1);
  assert.ok(![...all(f, "top"), ...all(f, "workspace")].some(row => row.id === child));
  assert.equal(f.lists.page(f.workspace, "top").items[0].id, parent);
  revision = f.lists.page(f.workspace, "top").revision;
  f.store.db.prepare("UPDATE tasks SET status='completed' WHERE id='task'").run();
  assert.ok(f.lists.page(f.workspace, "workspace").revision > revision);
  assert.equal(f.lists.summary(f.workspace, parent)?.activeTaskCount, 0);
  f.store.db.prepare("UPDATE sessions SET deletedAt=100 WHERE id=?").run(parent);
  assert.equal(f.lists.summary(f.workspace, parent), null);
  f.store.db.prepare("UPDATE workspaces SET archived=1 WHERE id=?").run(f.workspace);
  assert.equal(f.lists.summary(f.workspace, child), null);
  assert.equal(f.lists.first(f.workspace), null);
});

test("page, selected and first never fall back to the old full-list APIs", t => {
  const f = fixture(t);
  const selected = f.add({ updatedAt: 1 });
  for (let i = 0; i < 40; i++) f.add();
  f.add({ workspaceId: f.foreign, pinned: true });
  const forbidden = () => { throw Error("paged reads must not hydrate a full collection"); };
  const sessions = t.mock.method(f.store, "sessions", forbidden);
  const pins = t.mock.method(f.store, "pinnedSessions", forbidden);
  assert.equal(f.lists.page(f.workspace, "workspace").items.length, 30);
  assert.equal(f.lists.page(f.workspace, "top").items.length, 1);
  assert.equal(f.lists.summary(f.workspace, selected)?.id, selected);
  assert.ok(f.lists.first(f.workspace));
  assert.equal(sessions.mock.callCount(), 0); assert.equal(pins.mock.callCount(), 0);
});

test("insert, delete and fork reparenting stale cursors but same-value updates preserve them", t => {
  const f = fixture(t);
  const parent = f.add(), child = f.add();
  for (let i = 0; i < 64; i++) f.add();
  const before = f.lists.page(f.workspace, "workspace");
  f.store.db.prepare("UPDATE sessions SET title=title,pinned=pinned WHERE id=?").run(parent);
  assert.equal(f.lists.page(f.workspace, "workspace").revision, before.revision);
  assert.equal(f.lists.page(f.workspace, "workspace", "", before.next).items.length, 30);
  const staleAfter = (change: () => void) => {
    const page = f.lists.page(f.workspace, "workspace");
    assert.ok(page.next);
    change();
    assert.throws(() => f.lists.page(f.workspace, "workspace", "", page.next), code("CURSOR_STALE"));
  };
  let inserted = "";
  staleAfter(() => { inserted = f.add(); });
  staleAfter(() => { f.store.db.prepare("DELETE FROM sessions WHERE id=?").run(inserted); });
  staleAfter(() => { f.store.db.prepare("UPDATE sessions SET forkParentSessionId=? WHERE id=?").run(parent, child); });
  assert.equal(all(f, "workspace").find(row => row.id === child)?.familyId, parent);
});

test("locator and summary hydration stay bounded and share a read snapshot across an external commit", t => {
  const f = fixture(t);
  for (let i = 0; i < 180; i++) f.add({ title: "before", updatedAt: 1000 - i });
  const writer = f.openConnection();
  const prepare = f.store.db.prepare.bind(f.store.db);
  const observed = { locators: [] as number[], summaries: [] as number[] };
  let committed = false;
  t.mock.method(f.store.db, "prepare", (sql: string) => {
    const statement = prepare(sql);
    const kind = sql.includes("/* session-list locators */") ? "locators" : sql.includes("/* session-list summaries */") ? "summaries" : null;
    if (kind) {
      const execute = statement.all.bind(statement);
      t.mock.method(statement, "all", (...args: any[]) => {
        if (kind === "summaries" && !committed) {
          committed = true;
          writer.prepare("UPDATE sessions SET title='after' WHERE id=(SELECT id FROM sessions ORDER BY updatedAt DESC LIMIT 1)").run();
        }
        const rows = execute(...args); observed[kind].push(rows.length); return rows;
      });
    }
    return statement;
  });
  const page = f.lists.page(f.workspace, "workspace");
  assert.equal(committed, true, "writer commits between locator lookup and hydration");
  assert.equal(page.items.length, 30);
  assert.equal(page.items[0].title, "before", "same transaction must not mix new summaries with old locators");
  assert.deepEqual(observed.locators, [31]); assert.deepEqual(observed.summaries, [30]);
  const fresh = f.lists.page(f.workspace, "workspace");
  assert.ok(fresh.revision > page.revision); assert.equal(fresh.items[0].title, "after");
  assert.throws(() => f.lists.page(f.workspace, "workspace", "", page.next), code("CURSOR_STALE"));
});

test("visible count scopes validate a whole bounded workspace batch before transcript reads", t => {
  const f = fixture(t);
  const ids = Array.from({ length: 30 }, () => f.add());
  assert.deepEqual(f.lists.countScopes(f.workspace, ids), ids.map(sessionId => ({ workspaceId: f.workspace, sessionId })));
  for (const value of [undefined, null, [], [...ids, f.add()], [ids[0], ids[0]], [""], [" bad "], ["x\u0000y"], [1], ["x".repeat(201)]])
    assert.throws(() => f.lists.countScopes(f.workspace, value), code("INVALID_INPUT"));
  const foreign = f.add({ workspaceId: f.foreign }), archived = f.add({ workspaceId: f.archived });
  assert.throws(() => f.lists.countScopes(f.workspace, [ids[0], foreign]), code("SCOPE_MISMATCH"));
  assert.throws(() => f.lists.countScopes(f.workspace, ["missing"]), code("SCOPE_MISMATCH"));
  assert.throws(() => f.lists.countScopes(f.archived, [archived]), code("NOT_FOUND"));
  f.store.db.prepare("UPDATE sessions SET deletedAt=1 WHERE id=?").run(ids[0]);
  assert.throws(() => f.lists.countScopes(f.workspace, [ids[0]]), code("SCOPE_MISMATCH"));
  assert.deepEqual(f.lists.countScopes(f.foreign, [foreign]), [{ workspaceId: f.foreign, sessionId: foreign }]);
});
