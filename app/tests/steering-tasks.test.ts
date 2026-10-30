import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/storage.js";
import { TaskRecords, target } from "../src/server/tasks/records.js";
import { TaskScheduler } from "../src/server/tasks/scheduler.js";
import { TaskDelivery } from "../src/server/tasks/delivery.js";
import type { Agents } from "../src/server/agents.js";
import type { Workspace, Session, Draft } from "../src/shared/protocol.js";

for (const state of ["queued", "waiting", "starting", "inflight"]) for (const single of [false, true])
  test(`child ${single ? "single" : "all"} recall ${state}: ID acknowledgment, original draft order and attachments`, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-recall-child-")), store = new Store(root);
  try {
    const w = store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: root, authorized: true } }) as Workspace;
    const s = store.execute({ op: "session.create", workspaceId: w.id, requestId: randomUUID() }) as Session;
    const scope = { workspaceId: w.id, sessionId: s.id }, records = new TaskRecords(store);
    const selection = { provider: "fixture", id: "fixture", thinking: "off" as const };
    const task = records.create(scope, "anchor", "context", [{ task: "task" }], selection).taskIds[0];
    const row = () => records.rows("WHERE id=?", task)[0];
    // Delegation is not an editable user draft and must survive recall.
    const delegation = records.inputs(row(), "queued")[0].id;
    const first: Draft = { text: " first [file1] ", attachment: null, attachments: [{ id: "file1", name: "a", kind: "file", path: join(root, "a"), text: "" }] };
    const second: Draft = { text: "second", attachment: null, images: [{ id: "imag1", name: "original", mimeType: "image/png", data: "original bytes" }] };
    const one = records.queue(task, "expanded body one", "followUp"), two = records.queue(task, "expanded body two", "steer");
    records.drafts.set(one, first); records.drafts.set(two, second);
    store.db.prepare("UPDATE task_inputs SET state=? WHERE id IN (?,?)").run(state, one, two);
    store.db.prepare("UPDATE tasks SET status=? WHERE id=?").run(state === "queued" ? "queued" : "starting", task);
    let calls = 0;
    const agents = { store, publish: () => {}, info: () => ({ selection }), thread: () => ({ ids: [] }), setQueue: () => {},
      recallIds: async (to: unknown, ids: string[]) => { calls++; assert.deepEqual(to, target(row())); assert.deepEqual(ids, single ? [one] : [one, two]); return single ? [one] : [two, one]; },
    } as unknown as Agents;
    const delivery = new TaskDelivery(agents, records), scheduler = new TaskScheduler(agents, records, delivery);
    scheduler.closing = true; // This focused test must never launch a model.
    assert.deepEqual(await scheduler.recall(row(), "missing"), { drafts: [] });
    assert.equal(records.drafts.size, 2, "unknown input never falls back to all");
    const recalled = await scheduler.recall(row(), single ? one : undefined);
    assert.deepEqual(recalled.drafts, single ? [first] : [first, second]);
    assert.deepEqual(new Set(recalled.ids), new Set(single ? [one] : [one, two]));
    assert.equal(calls, ["queued", "waiting"].includes(state) ? 0 : 1);
    assert.equal(records.inputs(row(), "queued")[0].id, delegation);
    assert.equal(records.drafts.size, single ? 1 : 0);
    if (single) {
      assert.deepEqual(records.drafts.get(two), second, "other draft retains original image bytes");
      assert.ok(records.inputs(row(), state).some((input) => input.id === two));
    }
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

for (const single of [false, true]) test(`child mixed ${single ? "single" : "all"} recall failure does not delete locally queued drafts`, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-recall-failure-")), store = new Store(root);
  try {
    const w = store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: root, authorized: true } }) as Workspace;
    const s = store.execute({ op: "session.create", workspaceId: w.id, requestId: randomUUID() }) as Session;
    const records = new TaskRecords(store), selection = { provider: "fixture", id: "fixture", thinking: "off" as const };
    const task = records.create({ workspaceId: w.id, sessionId: s.id }, "anchor", "context", [{ task: "task" }], selection).taskIds[0];
    const row = records.rows("WHERE id=?", task)[0];
    const sent = records.queue(task, "sent", "steer"), queued = records.queue(task, "queued", "steer");
    for (const id of [sent, queued]) records.drafts.set(id, { text: id, attachment: null });
    store.db.prepare("UPDATE task_inputs SET state='inflight' WHERE id=?").run(sent);
    const agents = { store, publish: () => {}, info: () => ({}), setQueue: () => {}, recallIds: async () => { throw Error("lost ack"); } } as unknown as Agents;
    const scheduler = new TaskScheduler(agents, records, new TaskDelivery(agents, records)); scheduler.closing = true;
    await assert.rejects(scheduler.recall(row, single ? sent : undefined), /lost ack/);
    assert.ok(records.inputs(row, "queued").some((input) => input.id === queued));
    assert.equal(records.drafts.size, 2);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
