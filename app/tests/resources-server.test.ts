import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { tmpdir } from "./temporary.js";
import { startServer } from "../src/server/index.js";
import { Resources } from "../src/server/resources.js";
import type { Command, Reply, Scope, Session, Workspace } from "../src/shared/protocol.js";
import type { ResourceState } from "../src/shared/resources.js";

for (const kind of ["skill", "mcp"] as const) test(`${kind} uninstall deletes its files and configuration during active execution and permits reload`, { timeout: 30000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "axiom-resource-server-")), pi = join(root, "shared-pi");
  const oldPi = process.env.PI_CODING_AGENT_DIR, oldShared = process.env.AXIOM_PI_DIR;
  process.env.PI_CODING_AGENT_DIR = pi; process.env.AXIOM_PI_DIR = pi;
  const skillDir = join(root, "pi", "skills", "uninstall-fixture");
  mkdirSync(skillDir, { recursive: true }); mkdirSync(pi, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "---\nname: uninstall-fixture\ndescription: isolated uninstall regression\n---\nGuide\n");
  writeFileSync(join(skillDir, "attachment.txt"), "owned attachment");
  writeFileSync(join(pi, "mcp.json"), JSON.stringify({ mcpServers: { "uninstall-fixture": { command: "never-launched" }, keep: { command: "also-never-launched" } } }));
  mkdirSync(join(root, "resources"), { recursive: true });
  writeFileSync(join(root, "resources", "job.json"), JSON.stringify({ job: { id: "previous-failure", running: false, message: "操作未完成", error: "请先停止本机 Agent、子任务及压缩，再修改资源。" } }));
  const app = await startServer({ root, port: 0 });
  const ws = new WebSocket(app.origin.replace("http", "ws") + "/ws", { headers: { Origin: app.origin } });
  async function request(op: string, params = {}, scope = {}): Promise<Reply> {
    const requestId = randomUUID();
    const reply = new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => { ws.off("message", receive); reject(Error(`Receipt timeout: ${op}`)); }, 5000);
      function receive(raw: Buffer) {
        const value = JSON.parse(raw.toString());
        if (value.type !== "receipt" || value.requestId !== requestId) return;
        clearTimeout(timer); ws.off("message", receive); resolve(value);
      }
      ws.on("message", receive);
    });
    ws.send(JSON.stringify({ requestId, op, params, ...scope }));
    return reply;
  }
  async function call<T>(op: string, params = {}, scope = {}): Promise<T> {
    const result = await request(op, params, scope);
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.data as T;
  }
  async function settled() {
    for (let i = 0; i < 200; i++) {
      const state = await call<ResourceState>("resources.get");
      if (!state.job?.running) return state;
      await delay(10);
    }
    throw Error("Resource job did not settle");
  }
  try {
    await once(ws, "open");
    const archived = await call<Workspace>("workspace.open", { path: root, authorized: true });
    const history = await call<Session>("session.create", {}, { workspaceId: archived.id });
    await call("workspace.delete", { confirmed: true }, { workspaceId: archived.id });
    assert.equal(app.store.db.prepare("SELECT deletedAt FROM sessions WHERE id=?").get(history.id)!.deletedAt, null, "archival retains session history");
    const activePath = join(root, "active-project"); mkdirSync(activePath);
    const active = await call<Workspace>("workspace.open", { path: activePath, authorized: true });
    const session = await call<Session>("session.create", {}, { workspaceId: active.id });
    let state = await call<ResourceState>("resources.get");
    assert.match(state.job?.error ?? "", /请先停止本机 Agent/);
    // Keep execution, reload and background-work admission occupied throughout removal.
    t.mock.method(app.agents.reloads, "active", (scope: Scope) => scope.sessionId === session.id);
    t.mock.getter(app.agents, "maintenancePending", () => true);
    const invalidated = t.mock.method(app.agents.pool, "invalidate", async () => { throw Error("Resource removal must not retire workers"); });
    let managedId: string | undefined, managedDirectory: string | undefined;
    if (kind === "skill") {
      await call("resources.install", { kind: "skill", source: skillDir, name: "managed-uninstall", revision: state.revision });
      state = await settled();
      assert.equal(state.job?.error, undefined);
      const record = JSON.parse(readFileSync(join(root, "resources", "installed.json"), "utf8")).items[0];
      managedId = record.id; managedDirectory = record.directory;
      assert.ok(existsSync(managedDirectory!));
    }
    const item = state.items.find(row => row.kind === kind && row.name === "uninstall-fixture")!;
    assert.ok(item?.removable);
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const finishing = new Promise<void>(resolve => { entered = resolve; });
    const refresh = Resources.prototype.refresh;
    const held = t.mock.method(Resources.prototype, "refresh", async function (this: Resources, final = false) {
      const result = await refresh.call(this, final);
      if (final && this.store.root === root) { entered(); await gate; }
      return result;
    });
    const commands = t.mock.method(app.agents, "command", async (c: Command) => ({ admitted: c.op }));
    try {
      await call("resources.remove", { id: item.id, revision: state.revision, confirm: true });
      await finishing;
      const reload = await call<{ admitted: string }>("agent.reload", {}, { workspaceId: active.id, sessionId: session.id });
      assert.equal(reload.admitted, "agent.reload", "resource removal must not block session reload admission");
    } finally { release(); held.mock.restore(); commands.mock.restore(); }
    const removed = await settled();
    assert.equal(removed.job?.error, undefined);
    assert.equal(removed.items.some(row => row.id === item.id), false);
    const servers = JSON.parse(readFileSync(join(pi, "mcp.json"), "utf8")).mcpServers;
    if (kind === "skill") { assert.equal(existsSync(skillDir), false); assert.ok(servers["uninstall-fixture"]); }
    else { assert.equal(servers["uninstall-fixture"], undefined); assert.ok(existsSync(join(skillDir, "attachment.txt"))); }
    assert.ok(servers.keep);
    if (managedId) {
      await call("resources.remove", { id: managedId, revision: removed.revision, confirm: true });
      const cleared = await settled();
      assert.equal(cleared.job?.error, undefined);
      assert.equal(existsSync(managedDirectory!), false, "managed skill and its attachments are physically deleted");
      assert.deepEqual(JSON.parse(readFileSync(join(root, "resources", "installed.json"), "utf8")).items, []);
      assert.deepEqual(JSON.parse(readFileSync(join(root, "pi", "settings.json"), "utf8")).skills, []);
    }
    const refreshed = await call<ResourceState>("resources.get");
    assert.equal(refreshed.items.some(row => row.id === item.id || row.id === managedId), false);
    assert.equal(JSON.parse(readFileSync(join(root, "resources", "job.json"), "utf8")).job.error, undefined);
    assert.equal(invalidated.mock.callCount(), 0);
    assert.ok(app.store.db.prepare("SELECT 1 FROM sessions WHERE id=?").get(history.id));
  } finally {
    t.mock.restoreAll();
    ws.terminate(); await app.close();
    if (oldPi === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldPi;
    if (oldShared === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = oldShared;
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
