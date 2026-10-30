import assert from "node:assert/strict";
import test from "node:test";
import type { SessionListItem } from "../src/shared/session-list.js";
import { VisualActions, type VisualAction } from "../src/client/optimistic-actions.js";
import { activeSessionListBridge, applySessionListAction, bridgeSessionListAction, isSessionListAction,
  projectSessionListRows, refreshSessionListHeld, type SessionListBridge } from "../src/client/workspaces/session-list-projection.js";

const item = (id = "a", workspaceId = "w"): SessionListItem => ({
  id, workspaceId, title: `server-${id}`, pinned: false, unread: true, updatedAt: 123,
  familyId: "parent-outside-page", familyTop: true, forkParentSessionId: "not-loaded",
});
const action = (op: string, params: Record<string, unknown> = {}, sessionId = "a", workspaceId = "w", id = `${op}-${sessionId}`): VisualAction =>
  ({ id, op, params, target: { workspaceId, sessionId }, state: "pending" });

test("finite rows preserve server family/order and project only exact target fields, never captured insertion", () => {
  const rows = Array.from({ length: 30 }, (_, i) => item(`row-${i}`, i % 2 ? "foreign" : "w"));
  const rename = action("session.rename", { title: "visible edit" }, "row-0");
  const pin = action("session.pin", { pinned: true }, "not-loaded"); pin.session = item("not-loaded");
  const projected = projectSessionListRows(rows, [rename, pin]);
  assert.equal(projected.length, 30); assert.equal(projected[0].title, "visible edit");
  assert.deepEqual(projected.map(row => [row.id, row.familyId, row.familyTop, row.forkParentSessionId]),
    rows.map(row => [row.id, row.familyId, row.familyTop, row.forkParentSessionId]));
  assert.equal(projected[0].messageCount, undefined); assert.equal(projected[0].unread, true); assert.equal(projected[0].updatedAt, 123);
  assert.equal(projected[1], rows[1]); assert.equal(rows[0].title, "server-row-0");
  const wrongWorkspace = action("session.delete", {}, "row-0", "foreign");
  assert.equal(projectSessionListRows(rows, [wrongWorkspace, pin]), rows);
  for (const unrelated of [action("workspace.rename", { name: "x" }), action("workspace.pin", { pinned: true }), action("favorites.set", {})]) {
    assert.equal(isSessionListAction(unrelated), false); assert.equal(applySessionListAction(rows[0], unrelated), rows[0]);
  }
});

test("completed bridge and remaining pending intents keep existing reduce semantics, failures withdraw only themselves", () => {
  const rows = [item()], context = {}, visual = new VisualActions();
  const a = visual.begin("a", "session.rename", { title: "A" }, { workspaceId: "w", sessionId: "a" })!;
  const b = visual.begin("b", "session.rename", { title: "B" }, a.target)!;
  visual.remove(b.id); // finishVisual removes before the completed observer
  const bridge = bridgeSessionListAction(null, context, rows, b, 3);
  assert.equal(projectSessionListRows(rows, visual.list(), bridge)[0].title, "A", "old pending still overlays new completed, as in existing VisualActions");
  visual.uncertain(a.id);
  assert.equal(visual.list()[0].state, "uncertain");
  assert.equal(projectSessionListRows(rows, visual.list(), bridge)[0].title, "A");
  visual.remove(a.id); // failed, no completion materialization
  assert.equal(projectSessionListRows(rows, visual.list(), bridge)[0].title, "B");
  const pin = visual.begin("pin", "session.pin", { pinned: true }, a.target)!;
  assert.equal(projectSessionListRows(rows, visual.list(), bridge)[0].pinned, true);
  visual.remove(pin.id);
  const withPin = bridgeSessionListAction(bridge, context, rows, pin, 4);
  assert.equal(projectSessionListRows(rows, [], withPin)[0].title, "B");
  assert.equal(projectSessionListRows(rows, [], withPin)[0].pinned, true);
  assert.equal(rows[0].pinned, false); assert.equal(bridge.patches.size, 1);
});

test("server C replaces completed B on post-receipt acceptance, not field equality, elapsed time or a newer unaccepted epoch", () => {
  const rows = [item()], context = {};
  const bridge = bridgeSessionListAction(null, context, rows, action("session.rename", { title: "B" }), 3);
  const server = [{ ...item(), title: "C", unread: false, messageCount: 7, familyId: "server-family", familyTop: false, updatedAt: 999 }];
  assert.equal(projectSessionListRows(rows, [], activeSessionListBridge(bridge, context, 2))[0].title, "B");
  const after = projectSessionListRows(server, [], activeSessionListBridge(bridge, context, 3));
  assert.equal(after, server); assert.equal(after[0].title, "C"); assert.equal(after[0].messageCount, 7);
  assert.equal(after[0].familyId, "server-family"); assert.equal(after[0].familyTop, false);
  const offline = bridgeSessionListAction(bridge, context, rows, action("session.pin", { pinned: true }), null);
  assert.equal(activeSessionListBridge(offline, context, 300), offline, "no reader was started, so old accepted evidence cannot clear the bridge");
  const rebound = { ...offline, afterEpoch: 4 };
  assert.equal(projectSessionListRows(rows, [], activeSessionListBridge(rebound, context, 3))[0].pinned, true);
  assert.equal(projectSessionListRows(server, [], activeSessionListBridge(rebound, context, 4)), server);
});

test("later completion extends the fence for all compact fields and equal-valued new contexts never reuse old bridges", () => {
  const rows = [item()], context = { workspaceId: "w", query: "", generation: 1 };
  const first = bridgeSessionListAction(null, context, rows, action("session.rename", { title: "A" }), 3);
  const second = bridgeSessionListAction(first, context, rows, action("session.rename", { title: "B" }), 4);
  const third = bridgeSessionListAction(second, context, rows, action("session.pin", { pinned: true }), 5);
  const projected = projectSessionListRows(rows, [], activeSessionListBridge(third, context, 4));
  assert.equal(projected[0].title, "B"); assert.equal(projected[0].pinned, true);
  assert.equal(projectSessionListRows(rows, [], activeSessionListBridge(third, context, 5)), rows);
  const reactivated = { ...context };
  assert.equal(activeSessionListBridge(third, reactivated, 0), null);
  const fresh = bridgeSessionListAction(third, reactivated, rows, action("session.pin", { pinned: false }), 6);
  assert.deepEqual([...fresh.patches.values()], [{ pinned: false }]);
  assert.equal(projectSessionListRows(rows, [], first)[0].title, "A", "new completion never mutates prior immutable snapshots");
  const empty = bridgeSessionListAction(null, context, [], action("session.delete"), 7);
  assert.equal(empty.patches.size, 0); assert.deepEqual(projectSessionListRows([], [], empty), [], "no page yet still has a fence but never gains a captured row");
});

test("delete tombstones survive pending removal and target real workspaces without reviving captured sessions", () => {
  const rows = [item("a", "w"), item("a", "foreign"), item("other", "w")], context = {};
  const remove = action("session.delete"); remove.session = rows[0];
  const bridge = bridgeSessionListAction(null, context, rows, remove, 3);
  assert.deepEqual(projectSessionListRows(rows, [], activeSessionListBridge(bridge, context, 2)).map(row => [row.workspaceId, row.id]), [["foreign", "a"], ["w", "other"]]);
  const lateRename = bridgeSessionListAction(bridge, context, rows, action("session.rename", { title: "must not revive" }), 4);
  assert.equal(projectSessionListRows(rows, [], lateRename).some(row => row.workspaceId === "w" && row.id === "a"), false);
  const workspaceDelete = bridgeSessionListAction(lateRename, context, rows, action("workspace.delete"), 5);
  assert.deepEqual(projectSessionListRows(rows, [], workspaceDelete), [rows[1]]);
  const accepted = [rows[1]];
  assert.equal(projectSessionListRows(accepted, [], activeSessionListBridge(workspaceDelete, context, 5)), accepted);
  assert.equal(rows.length, 3);
});

test("many receipts compact to finite current-row fields rather than historical actions or old pages", () => {
  const context = {}; let bridge: SessionListBridge | null = null;
  for (let i = 0; i < 500; i++) {
    const page = Math.floor(i / 50), rows = [item(`target-${page}`), item(`neighbor-${page}`)];
    const intent = action(i % 2 ? "session.pin" : "session.rename", i % 2 ? { pinned: true } : { title: `title-${i}` }, rows[0].id);
    intent.session = { ...rows[0], runId: "do not retain captured full sessions" };
    bridge = bridgeSessionListAction(bridge, context, rows, intent, i + 1);
    assert.equal(bridge.patches.size, 1);
    for (const patch of bridge.patches.values()) assert.ok(Object.keys(patch).every(field => ["title", "pinned", "removed"].includes(field)));
    assert.ok([...bridge.patches.keys()].every(id => id.includes(`target-${page}`)));
  }
  assert.equal(bridge!.afterEpoch, 500);
});

test("held-only completion materializes target fields, accepted raw C persists across absence and clears missing optional fields", () => {
  const original = { ...item(), runId: "old-run", messageCount: 8 };
  let held: readonly SessionListItem[] = [original];
  const pendingRename = action("session.rename", { title: "unconfirmed" });
  assert.equal(projectSessionListRows(held, [pendingRename])[0].title, "unconfirmed");
  held = projectSessionListRows(held, [action("session.pin", { pinned: true })]);
  assert.equal(held[0].title, "server-a", "completed pin cannot materialize somebody else's pending rename");
  held = projectSessionListRows(held, [action("session.rename", { title: "B" })]);
  assert.equal(refreshSessionListHeld(held, []), held); assert.equal(held[0].title, "B");
  const c = { ...item(), title: "C" };
  held = refreshSessionListHeld(held, [item("a", "foreign"), c]);
  assert.equal(held[0], c); assert.equal(held[0].runId, undefined); assert.equal(held[0].messageCount, undefined);
  held = refreshSessionListHeld(held, []);
  assert.equal(held[0].title, "C", "leaving the next page cannot resurrect materialized B");
  held = projectSessionListRows(held, [action("session.delete")]);
  assert.deepEqual(held, []); assert.deepEqual(refreshSessionListHeld(held, [c]), [], "accepted server summaries cannot create a released/deleted held row");
});
