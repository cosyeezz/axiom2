import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agents } from "../src/server/agents.js";
import { ModelService } from "../src/server/model-service.js";
import { Store } from "../src/server/storage.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-admit-")), cwd = join(root, "project"), modelDir = join(root, "models");
  mkdirSync(cwd); mkdirSync(modelDir);
  const previous = { AXIOM_PI_DIR: process.env.AXIOM_PI_DIR, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
  Object.assign(process.env, { AXIOM_PI_DIR: modelDir, PI_CODING_AGENT_DIR: join(root, "native") });
  writeFileSync(join(modelDir, "models.json"), JSON.stringify({ providers: { "axiom-init-fixture": {
    api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [{ id: "fixture", name: "Fixture", contextWindow: 32000, maxTokens: 1000 }],
  } } }));
  writeFileSync(join(modelDir, "auth.json"), JSON.stringify({ "axiom-init-fixture": { type: "api_key", key: "fixture-only" } }));
  const store = new Store(root), models = new ModelService(root), agents = new Agents(store, models, () => {});
  const w = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: cwd, authorized: true } }) as Workspace;
  const s = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: w.id }) as Session;
  const scope = { workspaceId: w.id, sessionId: s.id }, selection = { provider: "axiom-init-fixture", id: "fixture", thinking: "off" };
  await agents.command({ op: "agent.model", requestId: randomUUID(), ...scope, params: { selection } });
  let discoveries = 0, profiles = 0, acquisitions = 0;
  // Keep this admission test independent of discovery side effects and process startup.
  (agents.capabilities as any).prepare = async () => { discoveries++; return undefined; };
  agents.profiles.prepareAsync = async () => { profiles++; throw Error("unexpected profile preparation"); };
  agents.pool.acquire = async () => { acquisitions++; throw Error("unexpected worker acquisition"); };
  return { root, cwd, store, models, agents, scope, selection,
    authorize(value: boolean) { store.db.prepare("UPDATE workspaces SET authorized=? WHERE id=?").run(Number(value), w.id); },
    counts() { return { discoveries, profiles, acquisitions }; },
    async close() {
      await agents.close(); store.close();
      for (const key of ["AXIOM_PI_DIR", "PI_CODING_AGENT_DIR"] as const) {
        if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

for (const kind of ["prompt", "child", "resume"] as const) {
  test(`unauthorized ${kind} cannot reach SDK initialization and a saved refusal never replays`, async () => {
    const f = await fixture(); f.authorize(false);
    const command = { requestId: randomUUID(), op: kind === "resume" ? "agent.resume" : "prompt", ...f.scope,
      params: kind === "resume" ? { expectedRunId: "fixture-old-run" } : { text: "not sent" } };
    const internal = kind === "child" ? { task: { id: "fixture-child", inputIds: [] } } : {};
    try {
      await assert.rejects(f.agents.command(command, internal), { code: "AUTHORIZATION_REQUIRED" });
      assert.deepEqual(f.counts(), { discoveries: 0, profiles: 0, acquisitions: 0 });
      assert.equal(existsSync(join(f.cwd, ".pi")), false);
      assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM runs").get()!.n, 0);
      assert.equal(f.store.receipt(command.requestId, f.scope).status, "failed");
      f.authorize(true);
      await assert.rejects(f.agents.command(command, internal), { code: "AUTHORIZATION_REQUIRED" });
      assert.deepEqual(f.counts(), { discoveries: 0, profiles: 0, acquisitions: 0 });
    } finally { await f.close(); }
  });
}

test("revocation after model-lock completion is checked again before initializing the execution profile", async () => {
  const f = await fixture(), serial = f.models.serial.bind(f.models), prepareAuth = f.models.prepareAuth.bind(f.models);
  let preparedAuth = false, revoked = false;
  f.models.prepareAuth = async (...args: Parameters<typeof f.models.prepareAuth>) => { await prepareAuth(...args); preparedAuth = true; };
  f.models.serial = (async (...args: Parameters<typeof f.models.serial>) => {
    const result = await serial(...args);
    if (preparedAuth && !revoked) { revoked = true; f.authorize(false); }
    return result;
  }) as typeof f.models.serial;
  const command = { requestId: randomUUID(), op: "prompt", ...f.scope, params: { text: "not sent" } };
  try {
    await assert.rejects(f.agents.command(command), { code: "AUTHORIZATION_REQUIRED" });
    assert.equal(revoked, true, "revocation lands after the existing in-lock validation");
    assert.equal(f.counts().profiles, 0); assert.equal(f.counts().acquisitions, 0);
    assert.equal(existsSync(join(f.cwd, ".pi")), false);
    assert.equal(f.store.receipt(command.requestId, f.scope).status, "failed");
    f.authorize(true);
    await assert.rejects(f.agents.command(command), { code: "AUTHORIZATION_REQUIRED" });
    assert.equal(f.counts().profiles, 0);
  } finally { await f.close(); }
});

for (const change of ["revoke", "cancel"] as const) {
  test(`cold reload ${change} after model-lock completion cannot initialize a profile`, async () => {
    const f = await fixture(), serial = f.models.serial.bind(f.models); let changed = false;
    f.models.serial = (async (...args: Parameters<typeof f.models.serial>) => {
      const result = await serial(...args);
      if (!changed) {
        changed = true;
        if (change === "revoke") f.authorize(false);
        else (f.agents.reloads as any).jobs.get(f.scope.sessionId).controller.abort();
      }
      return result;
    }) as typeof f.models.serial;
    try {
      await f.agents.command({ requestId: randomUUID(), op: "agent.reload", ...f.scope, params: {} });
      const deadline = Date.now() + 5000;
      while (f.agents.reloads.active(f.scope)) {
        assert.ok(Date.now() < deadline, "reload failure must settle");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(changed, true);
      assert.equal(f.agents.reloads.state(f.scope)?.status, "failed");
      assert.equal(f.counts().profiles, 0); assert.equal(f.counts().acquisitions, 0);
      assert.equal(existsSync(join(f.cwd, ".pi")), false);
    } finally { await f.close(); }
  });
}

test("revoking file authorization does not disable stop or a model-only selection", async () => {
  const f = await fixture(); f.authorize(false);
  try {
    await f.agents.command({ requestId: randomUUID(), op: "agent.model", ...f.scope, params: { selection: f.selection } });
    await f.agents.command({ requestId: randomUUID(), op: "agent.stop", ...f.scope, params: {} });
    assert.deepEqual(f.counts(), { discoveries: 0, profiles: 0, acquisitions: 0 });
    assert.equal(existsSync(join(f.cwd, ".pi")), false);
  } finally { await f.close(); }
});
