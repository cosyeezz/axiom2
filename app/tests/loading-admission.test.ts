import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { startServer } from "../src/server/index.js";
import { OpenDialog } from "../src/server/open-dialog.js";
import { FileManager } from "../src/server/file-manager.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

// Exercise admission against a real connection without making the OS send buffer nondeterministic.
test("collection admission cancels superseded requests without dropping active subscription updates", { timeout: 20000 }, async (t) => {
  const began = performance.now();
  const checkpoint = (stage: string) => t.diagnostic(`${stage}: ${Math.round(performance.now() - began)}ms`);
  // Native desktop preparation has separate host tests and 30s compilation/15s readiness bounds.
  // Keep that unrelated cold start out of this real WebSocket protocol's unchanged 20s budget.
  const dialogPreparation = t.mock.method(OpenDialog.prototype, "prepare", async () => {});
  const fileManagerPreparation = t.mock.method(FileManager.prototype, "prepare", async () => {});
  checkpoint("starting protocol fixture");
  const root = mkdtempSync(join(tmpdir(), "axiom-read-admission-"));
  mkdirSync(join(root, "project")); mkdirSync(join(root, "pi"));
  const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
  const app = await startServer({ root, port: 0 });
  checkpoint("server ready");
  const ws = new WebSocket(app.origin.replace("http", "ws") + "/ws", { origin: app.origin });
  let release!: () => void;
  try {
    assert.equal(dialogPreparation.mock.callCount(), 1, "the real server still prepares its shared dialog adapter");
    assert.equal(fileManagerPreparation.mock.callCount(), 1, "the real server still prepares its file-manager adapter");
    const workspace = app.store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: join(root, "project"), authorized: true } }) as Workspace;
    const session = app.store.execute({ op: "session.create", workspaceId: workspace.id, requestId: crypto.randomUUID() }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id }, key = `messages:${workspace.id}:${session.id}`;
    const snapshots: any[] = [], pending = new Map<string, (value: any) => void>();
    ws.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "snapshot") snapshots.push(event);
      if (event.type === "receipt") { pending.get(event.requestId)?.(event); pending.delete(event.requestId); }
    });
    await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    checkpoint("WebSocket open");
    const request = (op: string, params: Record<string, unknown> = {}, requestId = crypto.randomUUID()) => new Promise<any>((resolve) => {
      pending.set(requestId, resolve);
      ws.send(JSON.stringify({ requestId, op, params, ...scope }));
    });
    checkpoint("checking invalid subscription intents");
    for (let i = 0; i < 501; i++) {
      assert.equal((await request("subscribe", { scope: `invalid-${i}` })).ok, false);
      if ((i + 1) % 100 === 0) checkpoint(`${i + 1} invalid subscription intents rejected`);
    }
    assert.equal((await request("subscribe", { scope: "configuration" })).ok, true, "failed intents consume no subscription quota");
    await request("unsubscribe", { scope: "configuration" });
    checkpoint("subscription quota checked");
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = app.agents.command.bind(app.agents);
    app.agents.command = (async (c: any, internal?: any) => {
      if (c.op === "agent.original") { entered(); await gate; }
      return original(c, internal);
    }) as typeof app.agents.command;
    const raw = request("agent.original"); await started;
    const cancelled = request("subscribe", { scope: key });
    await request("ping");
    await request("unsubscribe", { scope: key });
    const current = request("subscribe", { scope: key });
    await request("ping"); release();
    assert.equal((await raw).ok, true);
    assert.equal((await cancelled).ok, true, "superseded subscription is not a failure of the new view");
    assert.equal((await current).ok, true);
    assert.equal(snapshots.filter((event) => event.scope === key).length, 1);
    checkpoint("initial subscription supersession checked");

    // Control-frame pong provides a wire-order barrier even while lazy application frames are blocked.
    const wireBarrier = () => new Promise<void>((resolve) => { ws.once("pong", () => resolve()); ws.ping(); });
    for (const publication of ["during-repeat", "before-repeats"]) {
      let enter!: () => void;
      const busy = new Promise<void>((resolve) => { enter = resolve; });
      const hold = new Promise<void>((resolve) => { release = resolve; });
      app.agents.command = (async (c: any, internal?: any) => {
        if (c.op === "agent.original") { enter(); await hold; }
        return original(c, internal);
      }) as typeof app.agents.command;
      const blocked = request("agent.original"); await busy;
      app.agents.messages = () => [{ id: publication, role: "assistant", text: publication }];
      if (publication === "before-repeats") app.agents.publish(key);
      const firstId = crypto.randomUUID(), first = request("subscribe", { scope: key }, firstId);
      await wireBarrier();
      let second: Promise<any> | undefined;
      let cancelId = firstId;
      if (publication === "before-repeats") {
        cancelId = crypto.randomUUID(); second = request("subscribe", { scope: key }, cancelId);
        await wireBarrier();
      } else app.agents.publish(key);
      const cancellation = request("read.cancel", { requestId: cancelId });
      await wireBarrier(); release();
      assert.equal((await blocked).ok, true);
      assert.equal((await first).data.superseded, true);
      if (second) assert.equal((await second).data.superseded, true);
      assert.equal((await cancellation).ok, true);
      await request("ping");
      assert.equal(snapshots.filter((event) => event.scope === key).at(-1)?.data[0]?.id, publication,
        "cancelled repeated subscriptions must preserve the active subscription's queued collection update");
      checkpoint(`${publication} cancellation and queued update checked`);
    }
    app.agents.messages = () => { throw new Error("snapshot read failed"); };
    assert.equal((await request("subscribe", { scope: key })).ok, false);
    app.agents.messages = () => [{ id: "after-failure", role: "assistant", text: "latest" }];
    app.agents.publish(key); await request("ping");
    assert.equal(snapshots.filter((event) => event.scope === key).at(-1)?.data[0]?.id, "after-failure",
      "failed repeated subscriptions leave the active subscription receiving updates");
    await request("unsubscribe", { scope: key });
    const last = snapshots.length;
    app.agents.publish(key);
    await request("ping");
    assert.equal(snapshots.length, last, "unsubscribed scopes receive no background publication");
    checkpoint("failed subscription recovery and unsubscribe checked");
  } finally {
    checkpoint("cleanup started");
    release?.(); ws.terminate(); await app.close();
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
    checkpoint("cleanup complete");
  }
});
