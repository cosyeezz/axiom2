import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "./temporary.js";
import { join } from "node:path";
import { resourceIdentity } from "../src/server/agents/resource-identity.js";
import { AgentRuns } from "../src/server/agents/runs.js";
import { Store } from "../src/server/storage.js";
import { Agents } from "../src/server/agents.js";
import { ModelService } from "../src/server/model-service.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { Session, Workspace } from "../src/shared/protocol.js";
import type { Run } from "../src/shared/agent.js";

test("resource identity changes on instructions, skill and extension edits", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-resource-"));
  try {
    const cwd = join(root, "project"), dir = join(root, "pi");
    mkdirSync(cwd); mkdirSync(dir);
    const first = resourceIdentity(cwd, dir);
    writeFileSync(join(cwd, "AGENTS.md"), "new instructions");
    const second = resourceIdentity(cwd, dir); assert.notEqual(first, second);
    mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "extensions", "example.ts"), "export default () => {}");
    assert.notEqual(second, resourceIdentity(cwd, dir));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("pending launch is active; stop invalidates it and waits, with exactly one cancelled settlement", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const saved: unknown[][] = [], settled: Run[] = [];
  const runs = new AgentRuns({ session() {}, finishRun: (...args: unknown[]) => saved.push(args) } as any, { changed() {} } as any, () => {});
  const scope = { workspaceId: "workspace", sessionId: "session" };
  (runs as any).retiringSessions.set(scope.sessionId, gate);
  runs.onSettled = (_scope, run) => settled.push(run);
  const run = { id: "run", status: "starting" } as Run;
  const launch = runs.launch(scope, run, {} as any);
  assert.equal(runs.active(scope), true);
  let stopped = false;
  const stop = runs.stop(scope).then(() => { stopped = true; });
  await Promise.resolve(); assert.equal(stopped, false);
  release();
  await assert.rejects(launch, { code: "AGENT_STOPPED" });
  await stop;
  assert.equal(runs.active(scope), false);
  assert.equal(settled.length, 1);
  assert.equal(settled[0].status, "cancelled");
  assert.equal(saved.length, 1);
});

test("starting another data root never cleans snapshots in shared pi or another service root", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-snapshot-isolation-"));
  const shared = join(root, "shared-pi"), first = join(root, "first"), second = join(root, "second");
  mkdirSync(shared); mkdirSync(join(first, "run-models"), { recursive: true });
  mkdirSync(join(second, "run-models"), { recursive: true });
  const name = "run-11111111-1111-1111-1111-111111111111.json";
  const legacy = join(shared, name), owned = join(first, "run-models", name), stale = join(second, "run-models", name);
  for (const file of [legacy, owned, stale]) writeFileSync(file, "{}");
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = shared;
  const store = new Store(second);
  let agents: Agents | undefined;
  try {
    agents = new Agents(store, new ModelService(second), () => {});
    assert.ok(existsSync(legacy), "shared legacy snapshots may still belong to a running service");
    assert.ok(existsSync(owned), "another data root retains its snapshot");
    assert.equal(existsSync(stale), false, "only owned stale snapshots are cleaned");
  } finally {
    await agents?.close(); store.close();
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("startup exceptions retain bounded redacted causes in the run and settlement", async () => {
  const saved: unknown[][] = [], settled: Run[] = [];
  const runs = new AgentRuns({ session() {}, finishRun: (...args: unknown[]) => saved.push(args) } as any, { changed() {} } as any, () => {});
  const cause = new Error("ENOENT: missing frozen model snapshot; api_key=sk-startup-secret");
  (runs as any).launchWorker = async () => { throw cause; };
  runs.onSettled = (_scope, run) => settled.push(run);
  const scope = { workspaceId: "workspace", sessionId: "session" }, run = { id: "run", status: "starting" } as Run;
  await assert.rejects(runs.launch(scope, run, {} as any), cause);
  assert.equal(runs.active(scope), false);
  assert.equal(run.status, "failed");
  assert.match(run.error!, /ENOENT: missing frozen model snapshot/);
  assert.doesNotMatch(run.error!, /sk-startup-secret/);
  assert.equal(settled.length, 1);
  assert.equal(saved[0][2], run.error);
  assert.equal(settled[0].error, run.error);
});

test("input identity query sees compacted native inputs without returning hidden bodies; ownership remains enforced", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-input-query-"));
  const project = join(root, "project"); mkdirSync(project); mkdirSync(join(root, "pi"));
  const store = new Store(root), agents = new Agents(store, new ModelService(root), () => {});
  try {
    const workspace = store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
    const session = store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    const manager = SessionManager.create(project, join(root, "sessions"));
    const id = crypto.randomUUID();
    manager.appendMessage({ role: "user", content: "PRIVATE_HIDDEN_BODY", timestamp: Date.now(), axiomInputIds: [id] } as any);
    manager.appendCompaction("compressed", null, 1000);
    // Pi flushes the initial buffer on the first assistant message.
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "ok" }], api: "openai-completions", provider: "fixture", model: "fixture", stopReason: "stop", timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(session.id, manager.getSessionFile()!);
    const result = await agents.command({ requestId: crypto.randomUUID(), op: "agent.inputs", ...scope, params: { ids: [id] } });
    assert.equal((result as any)[0].consumed, true);
    assert.equal(JSON.stringify(result).includes("PRIVATE_HIDDEN_BODY"), false);
    await assert.rejects(agents.command({ requestId: crypto.randomUUID(), op: "agent.inputs", workspaceId: "other", sessionId: session.id, params: { ids: [id] } }));
  } finally { await agents.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});
