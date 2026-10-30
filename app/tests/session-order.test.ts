import assert from "node:assert/strict";
import { test } from "node:test";
import type { Session } from "../src/shared/protocol.js";
import { compareSessions, isPrioritySession, isTopSession, sessionFamilies } from "../src/client/workspaces/session-order.js";

const session = (id: string, overrides: Partial<Session> = {}): Session => ({
  id, workspaceId: "workspace", title: id, pinned: false, unread: false, updatedAt: 1,
  listOrderAt: overrides.updatedAt ?? 1, ...overrides,
});
const order = (sessions: Session[]) => [...sessions].sort(compareSessions).map((s) => s.id);

test("automatic and manual top rows share a fixed order ahead of ordinary history", () => {
  const rows = [
    session("recent", { updatedAt: 100 }),
    session("running", { runStatus: "running", updatedAt: 2 }),
    session("unread", { unread: true, updatedAt: 3 }),
    session("child", { activeTasks: true, updatedAt: 4 }),
    session("pin", { pinned: true }),
    session("active-pin", { pinned: true, runStatus: "starting", updatedAt: 0 }),
  ];
  assert.deepEqual(order(rows), ["child", "unread", "running", "pin", "active-pin", "recent"]);
  assert.deepEqual(rows.filter(isTopSession).map((s) => s.id), ["running", "unread", "child", "pin", "active-pin"]);
  assert.equal(rows[0].id, "recent", "sorting cannot mutate subscription snapshots");
  assert.equal(rows[1].pinned, false, "automatic priority is not a persistent pin");
});

test("priority matches the running/unread dot, including stopping and active children", () => {
  for (const runStatus of ["starting", "running", "stopping"] as const)
    assert.equal(isPrioritySession(session(runStatus, { runStatus })), true);
  for (const runStatus of ["completed", "failed", "cancelled"] as const)
    assert.equal(isPrioritySession(session(runStatus, { runStatus })), false);
  assert.equal(isPrioritySession(session("new")), false);
  assert.equal(isPrioritySession(session("unread", { unread: true, runStatus: "failed" })), true);
  assert.equal(isPrioritySession(session("child", { activeTasks: true, runStatus: "completed" })), true);
});

test("unviewed priority follows activity; sessions without a cooldown retain the legacy idle order", () => {
  const recent = session("recent", { updatedAt: 100 });
  const target = session("target", { updatedAt: 2, runStatus: "running" });
  assert.deepEqual(order([recent, target]), ["target", "recent"]);
  target.runStatus = "completed";
  target.unread = true;
  assert.deepEqual(order([recent, target]), ["target", "recent"]);
  target.unread = false;
  assert.deepEqual(order([recent, target]), ["recent", "target"]);
  target.activeTasks = true;
  assert.deepEqual(order([recent, target]), ["target", "recent"]);
});

test("viewed idle pins expire, but activity overrides expired cooldowns", () => {
  const recent = session("recent", { updatedAt: 100 });
  const manual = session("manual", { pinned: true });
  const cooling = session("cooling", { updatedAt: 2, autoPinUntil: 123 });
  assert.deepEqual(order([recent, manual, cooling]), ["cooling", "manual", "recent"]);
  cooling.autoPinUntil = 0;
  cooling.runStatus = "running";
  assert.equal(isPrioritySession(cooling), true);
  assert.equal(isTopSession(cooling), true, "running sessions always stay at the top");
  assert.deepEqual(order([cooling, recent, manual]), ["cooling", "manual", "recent"]);
  cooling.runStatus = "completed";
  assert.equal(isTopSession(cooling), false);
  assert.deepEqual(order([cooling, recent, manual]), ["manual", "recent", "cooling"]);
  cooling.unread = true;
  assert.equal(isTopSession(cooling), true, "new unread output is always retained");
});

test("equal timestamps use stable session identity", () => {
  assert.deepEqual(order([session("b"), session("a")]), ["a", "b"]);
  assert.deepEqual(order([session("b", { pinned: true }), session("a", { pinned: true })]), ["a", "b"]);
});

test("top rows do not trade places on updates, unread, cooldown or run transitions", () => {
  const rows = [session("manual", { pinned: true, updatedAt: 3 }),
    session("active", { runStatus: "running", updatedAt: 2 }), session("unread", { unread: true })];
  const expected = order(rows);
  assert.deepEqual(expected, ["manual", "active", "unread"]);
  for (const runStatus of ["starting", "running", "stopping", "completed", "failed"] as const) {
    for (const row of rows) {
      row.updatedAt += 100;
      row.runStatus = runStatus;
      row.unread = !row.unread;
      row.autoPinUntil = 1000;
      assert.deepEqual(order([...rows].reverse()), expected);
    }
  }
  rows[2].activeTasks = true;
  rows[2].autoPinUntil = 0;
  assert.deepEqual(order(rows), expected);
});

test("the whole top family and its siblings keep their positions when a child becomes active", () => {
  const root = session("root", { pinned: true });
  const older = session("older", { forkParentSessionId: root.id, updatedAt: 2 });
  const newer = session("newer", { forkParentSessionId: root.id, updatedAt: 3 });
  const other = session("other", { pinned: true, updatedAt: 4 });
  const rows = [root, older, newer, other];
  const ids = () => sessionFamilies(rows).map(family => family.map(row => row.id));
  const expected = [["other"], ["root", "newer", "older"]];
  assert.deepEqual(ids(), expected);
  for (const child of [older, newer]) {
    child.updatedAt = 1000;
    child.runStatus = "running";
    assert.deepEqual(ids(), expected);
    child.runStatus = "completed";
    child.unread = true;
    assert.deepEqual(ids(), expected);
    child.unread = false;
    assert.deepEqual(ids(), expected);
  }
});
