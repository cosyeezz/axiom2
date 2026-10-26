import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/server/storage.js";
import { Agents } from "../src/server/agents.js";
import { ModelService } from "../src/server/model-service.js";
import { AppError, type Session, type Workspace } from "../src/shared/protocol.js";

test("snapshot preparation failure is persisted as failed, with no launch or automatic replay", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-preparation-"));
  const project = join(root, "project"), pi = join(root, "pi");
  mkdirSync(project); mkdirSync(pi);
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = pi;
  writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { "axiom-prepare-fixture": {
    api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1",
    models: [{ id: "fixture", name: "Fixture", contextWindow: 32000, maxTokens: 1000 }],
  } } }));
  writeFileSync(join(pi, "auth.json"), JSON.stringify({ "axiom-prepare-fixture": { type: "api_key", key: "fixture-only" } }));
  const store = new Store(root), agents = new Agents(store, new ModelService(root), () => {});
  let launches = 0;
  (agents as any).runs.launch = async () => { launches++; throw Error("Unexpected launch"); };
  try {
    const workspace = store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
    const session = store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    await agents.command({ requestId: crypto.randomUUID(), op: "agent.model", ...scope,
      params: { selection: { provider: "axiom-prepare-fixture", id: "fixture", thinking: "off" } } });
    rmSync(join(root, "run-models"), { recursive: true });
    const command = { requestId: crypto.randomUUID(), op: "prompt", ...scope, params: { text: "not sent" } };
    await assert.rejects(agents.command(command), (error: any) => {
      assert.equal(error.code, "PROMPT_PREPARATION_FAILED");
      assert.match(error.message, /ENOENT/);
      return true;
    });
    const receipt = store.receipt(command.requestId, scope);
    assert.equal(receipt.status, "failed");
    assert.match((receipt.data as any).message, /ENOENT/);
    assert.equal(launches, 0);
    assert.equal(agents.active(scope), false);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM runs").get()!.n, 0);
    mkdirSync(join(root, "run-models"));
    await assert.rejects(agents.command(command), { code: "PROMPT_PREPARATION_FAILED" });
    assert.equal(launches, 0, "same request returns its saved rejection after the directory is repaired");
    rmSync(join(root, "execution-models"), { recursive: true });
    const environmentFailure = { ...command, requestId: crypto.randomUUID() };
    await assert.rejects(agents.command(environmentFailure), { code: "PROMPT_PREPARATION_FAILED" });
    assert.equal(store.receipt(environmentFailure.requestId, scope).status, "failed");
    assert.equal(agents.active(scope), false);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM runs").get()!.n, 0);
    mkdirSync(join(root, "execution-models"));
    await assert.rejects(agents.command(environmentFailure), { code: "PROMPT_PREPARATION_FAILED" });
    assert.equal(launches, 0, "failed environment preparation never dispatches or replays");
    const profiles = (agents as any).profiles, prepare = profiles.prepareAsync.bind(profiles);
    let cleanupFailure = true;
    profiles.prepareAsync = async (...args: unknown[]) => {
      const environment = await prepare(...args);
      return { ...environment, release() {
        environment.release();
        if (cleanupFailure) { cleanupFailure = false; throw Error("fixture cleanup failure"); }
      } };
    };
    (agents as any).runs.launch = async (_scope: unknown, run: { id: string }) => {
      launches++;
      store.finishRun(run.id, "interrupted", "IPC delivery unconfirmed", "UNCERTAIN");
      throw new AppError("UNCERTAIN", "IPC delivery unconfirmed");
    };
    let memoryScans = 0;
    agents.memories.scanAsync = async () => { memoryScans++; throw new AppError("SCOPE_MISMATCH", "unavailable optional memory"); };
    const uncertain = { ...command, requestId: crypto.randomUUID() };
    await assert.rejects(agents.command(uncertain), { code: "UNCERTAIN" });
    assert.equal(store.receipt(uncertain.requestId, scope).status, "uncertain", "command wrapper must not relabel an attempted dispatch as a definite failure");
    assert.equal(agents.info(scope).run!.status, "interrupted", "existing settlement is not overwritten");
    await assert.rejects(agents.command(uncertain), { code: "UNCERTAIN" });
    assert.equal(launches, 1, "unconfirmed IPC must not replay the prompt");
    assert.equal(cleanupFailure, false, "environment cleanup failure was exercised without replacing UNCERTAIN");
    assert.equal(memoryScans, 0, "prompt admission must not wait for or require memory scans");
  } finally {
    await agents.close(); store.close();
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
