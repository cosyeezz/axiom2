import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/server/storage.js";
import { AgentViews } from "../src/server/agents/views.js";
import { sessionDuration } from "../src/client/chat/duration.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
import type { Run } from "../src/shared/agent.js";

test("session time accumulates across stops and sends, excludes idle gaps and survives reload", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-session-duration-"));
  let store = new Store(root);
  try {
    const workspace = store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
    const create = () => {
      const session = store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
      return { workspaceId: workspace.id, sessionId: session.id };
    };
    const scope = create(), other = create();
    let views = new AgentViews(store, () => {});
    const duration = (now: number) => sessionDuration(views.info(scope), now);
    const insert = (id: string, status: Run["status"], start: number, end: number | null, sessionId = scope.sessionId) =>
      store.db.prepare("INSERT INTO runs(id,sessionId,status,selection,startedAt,endedAt) VALUES(?,?,?,'{}',?,?)")
        .run(id, sessionId, status, start, end);

    assert.equal(duration(0), null, "no executions remain unknown");
    insert("first", "running", 1_000, null);
    assert.equal(duration(11_250), 10.25);
    store.db.prepare("UPDATE runs SET status='cancelled',endedAt=11250 WHERE id='first'").run();
    assert.equal(duration(100_000), 10.25, "stopped time stays frozen");

    insert("second", "starting", 100_000, null);
    assert.equal(duration(99_000), 10.25, "a stale UI tick cannot subtract previous time");
    assert.equal(duration(105_500), 15.75, "new execution retains the first execution");
    store.db.prepare("UPDATE runs SET status='stopping' WHERE id='second'").run();
    assert.equal(duration(106_000), 16.25, "stopping is still active until settlement");
    store.db.prepare("UPDATE runs SET status='completed',endedAt=106000 WHERE id='second'").run();
    assert.equal(duration(200_000), 16.25, "settlement does not double-count the last execution");

    insert("failed", "failed", 200_000, 202_000);
    insert("interrupted", "interrupted", 300_000, 303_000);
    insert("other", "completed", 1_000, 901_000, other.sessionId);
    assert.equal(duration(1_000_000), 21.25, "failure and interruption count, other sessions do not");
    assert.equal(sessionDuration(views.info(other), 1_000_000), 900);
    assert.throws(() => views.info({ ...scope, workspaceId: "wrong-workspace" }));

    store.close();
    store = new Store(root);
    views = new AgentViews(store, () => {});
    assert.equal(duration(2_000_000), 21.25, "reopening persisted history preserves the total");
    assert.equal(sessionDuration({ ...views.info(scope), completedRunDurationMs: undefined }, 2_000_000), null,
      "missing cumulative data must not be labelled as the session total");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
