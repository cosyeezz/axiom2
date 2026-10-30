import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { Store } from "../src/server/storage.js";
import { SessionLists } from "../src/server/session-list.js";

test("legacy sidebar anchors migrate once and survive rename, results, deletion, restore and restart", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-list-order-migration-"));
  let store: Store | undefined;
  try {
    const legacy = new DatabaseSync(join(root, "axiom.sqlite"));
    legacy.exec(`CREATE TABLE workspaces(id TEXT PRIMARY KEY,path TEXT NOT NULL,pathKey TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,authorized INTEGER NOT NULL);
      CREATE TABLE sessions(id TEXT PRIMARY KEY,workspaceId TEXT NOT NULL REFERENCES workspaces(id),title TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,unread INTEGER NOT NULL DEFAULT 0,updatedAt INTEGER NOT NULL,UNIQUE(workspaceId,id));`);
    legacy.prepare("INSERT INTO workspaces VALUES('w',?,?,'legacy',1)").run(root, root);
    legacy.exec("INSERT INTO sessions VALUES('older','w','Older',1,0,10),('newer','w','Newer',1,0,20)");
    legacy.close();
    store = new Store(root);
    const first = new SessionLists(store, "before-restart");
    const anchors = () => store!.db.prepare("SELECT id,listOrderAt FROM sessions ORDER BY id").all().map(row => ({ ...row }));
    assert.deepEqual(anchors(), [{ id: "newer", listOrderAt: 20 }, { id: "older", listOrderAt: 10 }]);
    const execute = (op: string, params = {}) => store!.execute({ requestId: crypto.randomUUID(), op, params, workspaceId: "w", sessionId: "older" });
    execute("session.rename", { title: "Renamed" });
    store.recordResult("older", "new-result", "run");
    assert.deepEqual(first.initial("w").top.items.map(row => row.id), ["newer", "older"]);
    execute("session.delete", { confirmed: true });
    execute("session.restore");
    assert.equal(store.session("w", "older").listOrderAt, 10);
    // The insertion trigger covers all callers, including forks, tasks and external writers.
    store.db.prepare("INSERT INTO sessions(id,workspaceId,title,pinned,updatedAt) VALUES('inserted','w','Inserted',1,30)").run();
    assert.equal(store.session("w", "inserted").listOrderAt, 30);
    const expected = anchors();
    const order = first.initial("w").top.items.map(row => row.id);
    store.close(); store = undefined;
    store = new Store(root);
    assert.deepEqual(anchors(), expected, "startup must not recapture recently updated timestamps");
    assert.deepEqual(new SessionLists(store, "after-restart").initial("w").top.items.map(row => row.id), order);
  } finally {
    store?.close();
    rmSync(root, { recursive: true, force: true });
  }
});
