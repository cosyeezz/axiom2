// Local selection/persistence regression tests; no model requests or remote credentials.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/storage.js";
import { ModelService } from "../src/server/model-service.js";
import { Agents } from "../src/server/agents.js";
import { kiroThinkingModel } from "../src/server/providers/kiro-thinking.js";
import { kiroCatalogScope } from "../src/server/providers/kiro-catalog.js";
import { running, type Selection } from "../src/shared/agent.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";

const first: Selection = {
  provider: "axiom-default-first",
  id: "reasoning-first",
  thinking: "high",
};
const second: Selection = {
  provider: "axiom-default-second",
  id: "reasoning-second",
  thinking: "low",
};

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "axiom-model-default-"));
  const pi = join(root, "pi");
  const previousPi = process.env.AXIOM_PI_DIR;
  // Explicit override prevents a developer's shared pi configuration being used.
  process.env.AXIOM_PI_DIR = pi;
  mkdirSync(pi);
  const modelsPath = join(pi, "models.json");
  writeFileSync(
    modelsPath,
    JSON.stringify({
      providers: Object.fromEntries(
        [first, second].map((selection) => [
          selection.provider,
          {
            api: "openai-completions",
            baseUrl: "http://127.0.0.1:1/v1",
            models: [
              {
                id: selection.id,
                name: selection.id,
                reasoning: true,
                input: ["text"],
                contextWindow: 32000,
                maxTokens: 1000,
              },
            ],
          },
        ]),
      ),
    }),
  );
  writeFileSync(
    join(pi, "auth.json"),
    JSON.stringify(
      Object.fromEntries(
        [first, second].map(({ provider }) => [
          provider,
          { type: "api_key", key: "isolated-fixture-not-a-secret" },
        ]),
      ),
    ),
  );
  let store = new Store(root);
  let agents = new Agents(store, new ModelService(root), () => {});
  t.after(async () => {
    try {
      await agents.close();
    } finally {
      store.close();
      if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
      else process.env.AXIOM_PI_DIR = previousPi;
      rmSync(root, { recursive: true, force: true });
    }
  });
  const workspace = (name: string) => {
    const path = join(root, name);
    mkdirSync(path);
    return store.execute({
      requestId: randomUUID(),
      op: "workspace.open",
      params: { path, authorized: true },
    }) as Workspace;
  };
  const main = workspace("project");
  return {
    modelsPath,
    main,
    workspace,
    get store() {
      return store;
    },
    get agents() {
      return agents;
    },
    create(workspaceId = main.id, requestId = randomUUID()): Scope {
      const session = store.execute({
        requestId,
        op: "session.create",
        workspaceId,
      }) as Session;
      return { workspaceId, sessionId: session.id };
    },
    select(scope: Scope, selection: unknown, requestId = randomUUID()) {
      return agents.command({
        requestId,
        op: "agent.model",
        ...scope,
        params: { selection },
      });
    },
    selection(scope: Scope) {
      return agents.info(scope).selection;
    },
    async restart() {
      await agents.close();
      store.close();
      store = new Store(root);
      agents = new Agents(store, new ModelService(root), () => {});
    },
  };
}

async function modelHttpRequests(t: TestContext, f: ReturnType<typeof fixture>) {
  let requests = 0;
  const server = createServer((request, response) => {
    requests++;
    request.resume();
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Unavailable selections must not request the fixture", type: "invalid_request_error" } }));
  });
  // Registered after fixture cleanup so workers stop before their endpoint closes.
  t.after(async () => {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const config = JSON.parse(readFileSync(f.modelsPath, "utf8"));
  for (const provider of Object.values(config.providers) as { baseUrl: string }[])
    provider.baseUrl = `http://127.0.0.1:${address.port}/v1`;
  writeFileSync(f.modelsPath, JSON.stringify(config));
  return () => requests;
}

async function failedRun(f: ReturnType<typeof fixture>, scope: Scope) {
  const id = f.agents.info(scope).run!.id, deadline = Date.now() + 30_000;
  while (running(f.agents.info(scope).run)) {
    assert.ok(Date.now() < deadline, "unavailable selection did not settle");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const run = f.agents.info(scope).run!;
  assert.equal(run.id, id);
  assert.equal(run.status, "failed");
  return run;
}

test("model default: no confirmed selection leaves new sessions unset", async (t) => {
  const f = fixture(t);
  const original = f.create();
  assert.equal(f.selection(original), null);
  await assert.rejects(
    f.agents.command({
      requestId: randomUUID(),
      op: "prompt",
      ...original,
      params: { text: "No model must mean no execution" },
    }),
    { code: "MODEL_UNAVAILABLE" },
  );
  await f.restart();
  assert.equal(f.selection(original), null);
  assert.equal(f.selection(f.create()), null);
});

test("model default: upgrade restores the last confirmed main model without relying on session update time", async (t) => {
  const f = fixture(t);
  const older = f.create();
  const latest = f.create();
  await f.select(older, first);
  await f.select(latest, second);
  // Simulate a database from before application-wide defaults were introduced.
  f.store.db.exec("DELETE FROM agent_preferences");
  f.store.db.prepare("UPDATE sessions SET updatedAt=? WHERE id=?")
    .run(Date.now() + 60000, older.sessionId);
  await f.restart();
  assert.deepEqual(f.selection(f.create()), second);
  assert.deepEqual(f.selection(older), first);
  assert.deepEqual(f.selection(latest), second);
  // An existing default always wins, even when a different session is newer.
  await f.select(older, first);
  await f.restart();
  assert.deepEqual(f.selection(f.create()), first);
});

test("model default: legacy sessions without receipts restore a main model, never a child model", async (t) => {
  const f = fixture(t);
  const parent = f.create();
  await f.select(parent, first);
  const child = f.create();
  f.store.db.prepare(
    "INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,status,budgets,createdAt) VALUES(?,?,?,?,?,?,'completed',?,?)",
  ).run(randomUUID(), parent.workspaceId, parent.sessionId, child.sessionId,
    "legacy", "legacy child", "{}", Date.now());
  await f.select(child, second);
  f.store.db.exec("DELETE FROM agent_preferences; DELETE FROM external_requests");
  await f.restart();
  assert.deepEqual(f.selection(f.create()), first);
  assert.deepEqual(f.selection(child), second);
});

test("model default: new sessions copy provider, model ID and thinking without changing existing sessions", async (t) => {
  const f = fixture(t);
  const unset = f.create();
  const main = f.create();
  await f.select(main, first);
  const inherited = f.create();
  assert.deepEqual(f.selection(inherited), first);
  assert.equal(f.selection(unset), null);

  await f.select(main, second);
  assert.deepEqual(f.selection(main), second);
  assert.deepEqual(f.selection(f.create()), second);
  assert.deepEqual(f.selection(inherited), first);
  assert.equal(f.selection(unset), null);

  // A thinking-only confirmation must become the default as well.
  const thinkingOnly = { ...second, thinking: "high" } satisfies Selection;
  await f.select(main, thinkingOnly);
  assert.deepEqual(f.selection(f.create()), thinkingOnly);
  assert.deepEqual(f.selection(inherited), first);
});

test("model default: Kiro thinking-only selections and edited capability survive reopen without network", async (t) => {
  const f = fixture(t), pi = dirname(f.modelsPath), root = dirname(pi);
  const id = "claude-opus-4.6", config = JSON.parse(readFileSync(f.modelsPath, "utf8"));
  config.providers.kiro = { modelOverrides: { [id]: { name: id } } };
  writeFileSync(f.modelsPath, JSON.stringify(config));
  const authPath = join(pi, "auth.json"), auth = JSON.parse(readFileSync(authPath, "utf8"));
  auth.kiro = { type: "oauth", access: "ISOLATED-ACCESS", refresh: "ISOLATED-REFRESH", expires: Date.now() + 3600000, authMethod: "builder-id", authRegion: "us-east-1" };
  writeFileSync(authPath, JSON.stringify(auth));
  const cachedModel = { id, name: id, api: "kiro-chat", provider: "kiro", baseUrl: "https://q.us-east-1.amazonaws.com", ...kiroThinkingModel(id), input: ["text", "image"], kiroSupportedInputTypes: ["TEXT", "IMAGE"], contextWindow: 200000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  writeFileSync(join(pi, "models-store.json"), JSON.stringify({ kiro: { models: [cachedModel], checkedAt: Date.now(), cacheVersion: 2, cacheScope: kiroCatalogScope(auth.kiro) } }));
  const service = new ModelService(root), draft = await service.read();
  const entry = draft.providers.find(provider => provider.providerId === "kiro")!.models[0];
  assert.deepEqual(entry.levels, ["none", "low", "medium", "high", "max"]);
  entry.levels = ["none", "low", "high"];
  await service.save(draft);
  const saved = await new ModelService(root).read();
  assert.deepEqual(saved.providers.find(provider => provider.providerId === "kiro")!.models[0].levels, ["none", "low", "high"]);
  const main = f.create(), high = { provider: "kiro", id, thinking: "high" } satisfies Selection;
  await f.select(main, high);
  assert.deepEqual(f.selection(f.create()), high);
  await f.restart();
  assert.deepEqual(f.selection(main), high); assert.deepEqual(f.selection(f.create()), high);
  const medium = { ...high, thinking: "medium" } satisfies Selection;
  // Selection persists user intent, even when the current catalog omits a level.
  await f.select(main, medium);
  assert.deepEqual(f.selection(main), medium); assert.deepEqual(f.selection(f.create()), medium);
  await f.restart(); assert.deepEqual(f.selection(main), medium);
  await f.select(main, { ...high, thinking: "low" });
  assert.deepEqual(f.selection(f.create()), { ...high, thinking: "low" });
});

test("model default: unavailable intent is retained without substitution; malformed selections cannot overwrite it", async (t) => {
  const f = fixture(t);
  const requests = await modelHttpRequests(t, f);
  const http = t.mock.method(globalThis, "fetch", async () => { throw Error("unavailable selection must not dispatch HTTP"); });
  const main = f.create();
  await f.select(main, first);
  for (const selection of [
    { ...second, provider: "unconfigured-provider" },
    { ...second, id: "missing-model" },
  ]) {
    await f.select(main, selection);
    assert.deepEqual(f.selection(main), selection);
    assert.deepEqual(f.selection(f.create()), selection);
    await f.agents.command({ requestId: randomUUID(), op: "prompt", ...main, params: { text: "Unavailable intent must not dispatch" } });
    const run = await failedRun(f, main);
    assert.deepEqual(run.selection, selection);
    assert.match(run.error!, /Model not found/);
    assert.deepEqual(f.selection(main), selection);
    assert.equal(http.mock.callCount(), 0, "parent metadata remains offline");
    assert.equal(requests(), 0, "worker must not call either fixture provider or substitute an available model");
  }
  const retained = f.selection(main);
  for (const selection of [{ ...second, thinking: "not-a-thinking-level" }, { ...second, extra: true }]) {
    await assert.rejects(f.select(main, selection), { code: "INVALID_INPUT" });
    assert.deepEqual(f.selection(main), retained);
    assert.deepEqual(f.selection(f.create()), retained);
  }
});

test("model default: survives restart and is application-wide across workspaces", async (t) => {
  const f = fixture(t);
  const main = f.create();
  const otherWorkspace = f.workspace("other-project");
  const existingOther = f.create(otherWorkspace.id);
  await f.select(main, first);
  await f.restart();
  assert.deepEqual(f.selection(main), first);
  assert.deepEqual(f.selection(f.create()), first);
  assert.deepEqual(f.selection(f.create(otherWorkspace.id)), first);
  assert.equal(f.selection(existingOther), null);

  await f.select(existingOther, second);
  await f.restart();
  assert.deepEqual(f.selection(f.create()), second);
  assert.deepEqual(f.selection(f.create(otherWorkspace.id)), second);
  assert.deepEqual(f.selection(main), first);
  assert.deepEqual(f.selection(existingOther), second);
});

test("model default: child session confirmations do not change the application default", async (t) => {
  const f = fixture(t);
  const parent = f.create();
  await f.select(parent, first);
  const child = f.create();
  // Establish real task ownership without launching a child worker.
  f.store.db
    .prepare(
      "INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,status,budgets,createdAt) VALUES(?,?,?,?,?,?,'completed',?,?)",
    )
    .run(
      randomUUID(),
      parent.workspaceId,
      parent.sessionId,
      child.sessionId,
      "fixture-anchor",
      "Model default isolation fixture",
      JSON.stringify({ work: 600, wrap: 180, summary: 60, cleanup: 10 }),
      Date.now(),
    );
  assert.ok(f.agents.info(child).task);
  await f.select(child, second);
  assert.deepEqual(f.selection(child), second);
  assert.deepEqual(f.selection(parent), first);
  assert.deepEqual(f.selection(f.create()), first);
  await f.restart();
  assert.deepEqual(f.selection(child), second);
  assert.deepEqual(f.selection(f.create()), first);
});

test("model default: replaying old confirmation and creation receipts cannot roll back selections", async (t) => {
  const f = fixture(t);
  const main = f.create();
  const oldConfirmation = randomUUID();
  const accepted = await f.select(main, first, oldConfirmation);
  const oldCreation = randomUUID();
  const created = f.create(f.main.id, oldCreation);
  await f.select(main, second);
  await f.restart();

  // Receipts use JSON storage/transport, which omits optional undefined fields.
  assert.deepEqual(
    await f.select(main, first, oldConfirmation),
    JSON.parse(JSON.stringify(accepted)),
  );
  assert.deepEqual(f.selection(main), second);
  assert.deepEqual(f.create(f.main.id, oldCreation), created);
  assert.deepEqual(f.selection(created), first);
  assert.deepEqual(f.selection(f.create()), second);
  await assert.rejects(f.select(main, second, oldConfirmation), {
    code: "REQUEST_CONFLICT",
  });
  assert.deepEqual(f.selection(f.create()), second);
});

test("model default: preference write failures roll back the session selection atomically", async (t) => {
  const f = fixture(t);
  const main = f.create();
  f.store.db.exec(
    "CREATE TEMP TRIGGER fail_default_insert BEFORE INSERT ON agent_preferences BEGIN SELECT RAISE(ABORT,'fixture write failure'); END",
  );
  try {
    await assert.rejects(f.select(main, first), { code: "UNCERTAIN" });
    assert.equal(f.selection(main), null);
    assert.equal(f.selection(f.create()), null);
  } finally {
    f.store.db.exec("DROP TRIGGER fail_default_insert");
  }

  await f.select(main, first);
  f.store.db.exec(
    "CREATE TEMP TRIGGER fail_default_update BEFORE UPDATE ON agent_preferences BEGIN SELECT RAISE(ABORT,'fixture write failure'); END",
  );
  try {
    await assert.rejects(f.select(main, second), { code: "UNCERTAIN" });
    assert.deepEqual(f.selection(main), first);
    assert.deepEqual(f.selection(f.create()), first);
  } finally {
    f.store.db.exec("DROP TRIGGER fail_default_update");
  }
  await f.restart();
  assert.deepEqual(f.selection(main), first);
  assert.deepEqual(f.selection(f.create()), first);
  await f.select(main, second);
  assert.deepEqual(f.selection(f.create()), second);
});

test("model default: unavailable saved default is retained, never substituted, and fails its accepted run", async (t) => {
  const f = fixture(t);
  const requests = await modelHttpRequests(t, f);
  const http = t.mock.method(globalThis, "fetch", async () => { throw Error("unavailable default must not dispatch HTTP"); });
  const main = f.create();
  await f.select(main, first);
  writeFileSync(f.modelsPath, JSON.stringify({ providers: {} }));
  await f.restart();
  const inherited = f.create();
  assert.deepEqual(f.selection(main), first);
  assert.deepEqual(f.selection(inherited), first);
  await f.agents.command({
    requestId: randomUUID(), op: "prompt", ...inherited,
    params: { text: "Unavailable default must not dispatch HTTP" },
  });
  const run = await failedRun(f, inherited);
  assert.deepEqual(run.selection, first);
  assert.match(run.error!, /Model not found/);
  assert.equal(http.mock.callCount(), 0, "parent metadata remains offline");
  assert.equal(requests(), 0, "worker must not reuse the removed provider configuration");
  assert.deepEqual(f.selection(main), first);
  assert.deepEqual(f.selection(inherited), first);
  assert.deepEqual(f.selection(f.create()), first);
});
