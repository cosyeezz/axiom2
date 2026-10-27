import assert from "node:assert/strict";
import { test } from "node:test";
import { VisualActions, projectVisualAction } from "../src/client/optimistic-actions.js";
import type { Session } from "../src/shared/protocol.js";

const session: Session = { id: "s", workspaceId: "w", title: "Before", pinned: false, unread: false, updatedAt: 1 };
const target = { workspaceId: "w", sessionId: "s" };
test("rename is immediate, stable, and rollback preserves intervening server data", () => {
  const actions = new VisualActions();
  const base = [session];
  actions.begin("a", "session.rename", { title: "After" }, target);
  const projected = actions.project("sessions:w", base);
  assert.equal(projected[0].title, "After");
  assert.equal(actions.project("sessions:w", base), projected, "React external-store snapshots must be stable");
  assert.equal(base[0].title, "Before");
  const latest = [{ ...session, title: "Other window", messageCount: 42, unread: true }];
  assert.equal(actions.project("sessions:w", latest)[0].messageCount, 42);
  actions.remove("a");
  assert.equal(actions.project("sessions:w", latest), latest);
});
test("overlapping edits roll back independently, never to captured arrays", () => {
  const actions = new VisualActions();
  actions.begin("old", "session.rename", { title: "First" }, target);
  actions.begin("new", "session.rename", { title: "Second" }, target);
  actions.begin("pin", "session.pin", { pinned: true }, target, session);
  actions.remove("old");
  assert.deepEqual(actions.project("sessions:w", [session]), [{ ...session, title: "Second", pinned: true }]);
  actions.remove("new");
  assert.deepEqual(actions.project("sessions:w", [session]), [{ ...session, pinned: true }]);
});
test("delete masks every list and detail, including held rows, without erasing facts", () => {
  const actions = new VisualActions();
  actions.begin("delete", "session.delete", { confirmed: true }, target);
  assert.deepEqual(actions.project("sessions:w", [session]), []);
  assert.deepEqual(actions.project("pinned-sessions", [session]), []);
  assert.equal(actions.project("session:w:s", session), null);
  assert.equal(actions.hidden(session), true);
  actions.uncertain("delete");
  assert.equal(actions.list()[0].state, "uncertain");
  assert.equal(actions.hidden(session), true, "unknown result is not declared a failed deletion");
  actions.remove("delete");
  assert.equal(actions.hidden(session), false);
});
test("pin enters global list before any broadcast and preserves streamed fields", () => {
  const actions = new VisualActions();
  const action = actions.begin("pin", "session.pin", { pinned: true }, target, session)!;
  assert.deepEqual(actions.project("pinned-sessions", []), [{ ...session, pinned: true }]);
  assert.deepEqual(projectVisualAction("session:w:s", { ...session, messageCount: 12 }, action), { ...session, messageCount: 12, pinned: true });
});
test("workspace deletion masks foreign pinned rows as well as its own list", () => {
  const actions = new VisualActions();
  actions.begin("delete", "workspace.delete", { confirmed: true }, { workspaceId: "w" });
  const other = { ...session, workspaceId: "other", id: "other" };
  assert.deepEqual(actions.project("pinned-sessions", [session, other]), [other]);
  assert.deepEqual(actions.project("sessions:w", [session]), []);
  assert.deepEqual(actions.project("workspaces", [{ id: "w" }, { id: "other" }]), [{ id: "other" }]);
});
test("favorites update immediately and opposite rapid clicks are independent", () => {
  const actions = new VisualActions(), model = { provider: "p", id: "m" };
  actions.begin("favorite", "favorites.set", { ...model, favorite: true }, {});
  assert.deepEqual(actions.project("favorites", []), [model]);
  actions.begin("unfavorite", "favorites.set", { ...model, favorite: false }, {});
  assert.deepEqual(actions.project("favorites", []), []);
  actions.remove("unfavorite");
  assert.deepEqual(actions.project("favorites", []), [model]);
  actions.remove("favorite");
  assert.deepEqual(actions.project("favorites", []), []);
});
test("authorization and installation outcomes are never optimistically invented", () => {
  const actions = new VisualActions();
  assert.equal(actions.begin("install", "rea.install", {}, {}), undefined);
  assert.equal(actions.begin("model", "agent.model", {}, target), undefined);
  assert.deepEqual(actions.list(), []);
});
