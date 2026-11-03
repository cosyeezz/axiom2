import test from "node:test";
import assert from "node:assert/strict";
import { AgentRuns } from "../src/server/agents/runs.js";

const scope = { workspaceId: "w", sessionId: "s" };
function fixture() {
  let stored = true, pooled = true, retired = 0;
  const runs = new AgentRuns({ session: (workspace: string) => { if (!stored || workspace !== "w") throw Error("not found"); }, db: { prepare: () => ({ run: () => {} }) } } as any,
    { changed: () => {} } as any, () => {}, { isActive: () => pooled, retire: async () => { retired++; } } as any);
  const live = { scope, task: false, run: { id: "r", status: "running" }, child: { connected: true }, lease: { ref: { instanceId: "i", generation: 1, leaseId: "l" } } } as any;
  (runs as any).live.set("s", live);
  return { runs, live, revokeStore: () => { stored = false; }, revokePool: () => { pooled = false; }, retired: () => retired };
}
test("host main-tool admission rejects wrong run/scope, subagents and every inactive owner state", () => {
  const { runs, live } = fixture();
  assert.equal(runs.webLease(scope, "r"), live.lease.ref);
  assert.equal(runs.webLease(scope, "other"), undefined);
  assert.equal(runs.webLease({ ...scope, workspaceId: "other" }, "r"), undefined);
  for (const field of ["task", "ownerEnded", "finish", "closed", "terminating"]) {
    live[field] = true; assert.equal(runs.webLease(scope, "r"), undefined, field); delete live[field];
  }
  live.run.status = "stopping"; assert.equal(runs.webLease(scope, "r"), undefined); live.run.status = "running";
  live.child.connected = false; assert.equal(runs.webLease(scope, "r"), undefined); live.child.connected = true;
  runs.closing = true; assert.equal(runs.webLease(scope, "r"), undefined);
  const missingStore = fixture(); missingStore.revokeStore(); assert.equal(missingStore.runs.webLease(scope, "r"), undefined);
  const missingPool = fixture(); missingPool.revokePool(); assert.equal(missingPool.runs.webLease(scope, "r"), undefined);
});
test("stop revokes tool owner synchronously and exactly once before pool retirement", () => {
  const { runs, live, retired } = fixture(); let endings = 0;
  runs.onEnding = (endedScope, run) => { assert.deepEqual(endedScope, scope); assert.equal(run.id, "r"); assert.equal(retired(), 0); assert.equal(runs.webLease(scope, "r"), undefined); endings++; };
  (runs as any).stopLive(live);
  assert.equal(endings, 1); assert.equal(retired(), 1); assert.equal(live.run.status, "stopping");
  (runs as any).stopLive(live); (runs as any).kill(live); assert.equal(endings, 1);
});
