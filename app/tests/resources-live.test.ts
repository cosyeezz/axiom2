import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { tmpdir } from "./temporary.js";
import { startServer } from "../src/server/index.js";
import { Resources } from "../src/server/resources.js";
import type { Command, Reply, Session, Workspace } from "../src/shared/protocol.js";
import type { ResourceDetail, ResourceState } from "../src/shared/resources.js";

for (const kind of ["skill", "mcp"] as const) test(`${kind} can be read, saved and added during execution without retiring workers or blocking reload`, { timeout: 30000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "axiom-resource-live-")), pi = join(root, "shared-pi");
  const oldPi = process.env.PI_CODING_AGENT_DIR, oldShared = process.env.AXIOM_PI_DIR;
  process.env.PI_CODING_AGENT_DIR = pi; process.env.AXIOM_PI_DIR = pi;
  const skillDir = join(root, "pi", "skills", "live-fixture"), guide = join(skillDir, "SKILL.md");
  mkdirSync(skillDir, { recursive: true }); mkdirSync(pi, { recursive: true });
  writeFileSync(guide, "---\nname: live-fixture\ndescription: live save regression\n---\nOriginal guide\n");
  writeFileSync(join(pi, "mcp.json"), JSON.stringify({ mcpServers: { "live-fixture": { command: "never-launched" } } }));
  const app = await startServer({ root, port: 0 });
  const ws = new WebSocket(app.origin.replace("http", "ws") + "/ws", { headers: { Origin: app.origin } });
  async function request(op: string, params = {}, scope = {}): Promise<Reply> {
    const requestId = randomUUID();
    const response = new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => { ws.off("message", receive); reject(Error(`Receipt timeout: ${op}`)); }, 5000);
      function receive(raw: Buffer) {
        const value = JSON.parse(raw.toString());
        if (value.type !== "receipt" || value.requestId !== requestId) return;
        clearTimeout(timer); ws.off("message", receive); resolve(value);
      }
      ws.on("message", receive);
    });
    ws.send(JSON.stringify({ requestId, op, params, ...scope }));
    return response;
  }
  async function call<T>(op: string, params = {}, scope = {}): Promise<T> {
    const reply = await request(op, params, scope);
    assert.equal(reply.ok, true, JSON.stringify(reply));
    return reply.data as T;
  }
  async function settled() {
    for (let i = 0; i < 200; i++) {
      const state = await call<ResourceState>("resources.get");
      if (!state.job?.running) return state;
      await delay(10);
    }
    throw Error("Resource operation did not settle");
  }
  let releaseSave = () => {}, releaseCommand = () => {};
  try {
    await once(ws, "open");
    const workspace = await call<Workspace>("workspace.open", { path: root, authorized: true });
    const session = await call<Session>("session.create", {}, { workspaceId: workspace.id });
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    // Exercise real server admission without a provider call or a running MCP executable.
    t.mock.method(app.agents, "active", () => true);
    const invalidated = t.mock.method(app.agents.pool, "invalidate", async () => { throw Error("Online writes must not retire workers"); });
    const state = await call<ResourceState>("resources.get");
    const item = state.items.find(row => row.kind === kind && row.name === "live-fixture")!;
    assert.ok(item);
    const replacement = await request("resources.install", { id: item.id, kind, revision: state.revision, source: skillDir });
    assert.equal(replacement.ok, false);
    if (!replacement.ok) assert.equal(replacement.error.code, "INVALID_INPUT", "install cannot bypass update admission by naming an existing target");
    const detail = await call<ResourceDetail>("resources.detail", { id: item.id });
    const saveParams = kind === "skill"
      ? { path: guide, content: detail.documents[0].content.replace("Original guide", "Updated guide") }
      : { config: JSON.stringify({ command: "never-launched", description: "Updated connection" }) };

    // Hold a scoped command open, so workspaceOperations is nonempty during the save.
    let commandStarted!: () => void;
    const commandEntered = new Promise<void>(resolve => { commandStarted = resolve; });
    const commandGate = new Promise<void>(resolve => { releaseCommand = resolve; });
    const command = t.mock.method(app.agents, "command", async (c: Command) => {
      if (c.op === "agent.resume") { commandStarted(); await commandGate; }
      return { admitted: c.op };
    });
    const ongoing = call("agent.resume", {}, scope);
    await commandEntered;

    // Keep the save admitted long enough to test the reverse execution gate.
    let saveStarted!: () => void;
    const saveEntered = new Promise<void>(resolve => { saveStarted = resolve; });
    const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    const refresh = Resources.prototype.refresh;
    const held = t.mock.method(Resources.prototype, "refresh", async function (this: Resources, finishing = false) {
      const result = await refresh.call(this, finishing);
      if (finishing && this.store.root === root) { saveStarted(); await saveGate; }
      return result;
    });
    await call("resources.save", { id: item.id, revision: detail.revision, ...saveParams });
    await saveEntered;
    const reload = await call<{ admitted: string }>("agent.reload", {}, scope);
    assert.equal(reload.admitted, "agent.reload", "online saving must not block session reload admission");
    const duplicate = await request("resources.save", { id: item.id, revision: detail.revision, ...saveParams });
    assert.equal(duplicate.ok, false);
    if (!duplicate.ok) assert.equal(duplicate.error.code, "RESOURCE_BUSY", "resource writes remain serialized");
    releaseSave(); releaseCommand(); await ongoing;
    held.mock.restore(); command.mock.restore();
    const saved = await settled();
    assert.equal(saved.job?.error, undefined);
    if (kind === "skill") assert.match(readFileSync(guide, "utf8"), /Updated guide/);
    else assert.equal(JSON.parse(readFileSync(join(pi, "mcp.json"), "utf8")).mcpServers["live-fixture"].description, "Updated connection");

    const installParams = kind === "skill"
      ? { kind, name: "added-live", source: skillDir }
      : { kind, name: "added-live", config: JSON.stringify({ command: "also-never-launched" }) };
    await call("resources.install", { revision: saved.revision, ...installParams });
    const installed = await settled();
    assert.equal(installed.job?.error, undefined);
    assert.ok(installed.items.some(row => row.kind === kind && row.name === "added-live"));
    assert.equal(invalidated.mock.callCount(), 0);
    invalidated.mock.restore();
  } finally {
    releaseSave(); releaseCommand();
    t.mock.restoreAll();
    ws.terminate(); await app.close();
    if (oldPi === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldPi;
    if (oldShared === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = oldShared;
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
