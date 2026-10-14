import assert from "node:assert/strict";
import { test } from "node:test";
import type { Session } from "../src/shared/protocol.js";
import { compareSessions, isPrioritySession, isTopSession } from "../src/client/workspaces/session-order.js";

const session = (id: string, overrides: Partial<Session> = {}): Session => ({
  id, workspaceId: "workspace", title: id, pinned: false, unread: false, updatedAt: 1,
  ...overrides,
});
const order = (sessions: Session[]) => [...sessions].sort(compareSessions).map((s) => s.id);

test("running and unread precede idle manual pins and share recency order", () => {
  const rows = [
    session("recent", { updatedAt: 100 }),
    session("running", { runStatus: "running", updatedAt: 2 }),
    session("unread", { unread: true, updatedAt: 3 }),
    session("child", { activeTasks: true, updatedAt: 4 }),
    session("pin", { pinned: true }),
    session("active-pin", { pinned: true, runStatus: "starting", updatedAt: 0 }),
  ];
  assert.deepEqual(order(rows), ["child", "unread", "running", "active-pin", "pin", "recent"]);
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

test("viewed automatic pins stay above manual pins until expiry, then use normal workspace recency", () => {
  const recent = session("recent", { updatedAt: 100 });
  const manual = session("manual", { pinned: true });
  const cooling = session("cooling", { updatedAt: 2, autoPinUntil: 123 });
  assert.deepEqual(order([recent, manual, cooling]), ["cooling", "manual", "recent"]);
  cooling.autoPinUntil = 0;
  cooling.runStatus = "running";
  assert.equal(isPrioritySession(cooling), true, "running indicator survives returning to history");
  assert.equal(isTopSession(cooling), false);
  assert.deepEqual(order([cooling, recent, manual]), ["manual", "recent", "cooling"]);
  cooling.unread = true;
  assert.equal(isTopSession(cooling), true, "new unread output is always retained");
});

test("equal timestamps use stable session identity", () => {
  assert.deepEqual(order([session("b"), session("a")]), ["a", "b"]);
});
