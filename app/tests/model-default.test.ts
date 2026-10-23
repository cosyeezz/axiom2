// Local selection/persistence regression tests; no model requests or remote credentials.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/storage.js";
import { ModelService } from "../src/server/model-service.js";
import { Agents } from "../src/server/agents.js";
import type { Selection } from "../src/shared/agent.js";
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

test("model default: invalid model, thinking and malformed selection cannot overwrite the default", async (t) => {
  const f = fixture(t);
  const main = f.create();
  await f.select(main, first);
  for (const selection of [
    { ...second, provider: "unconfigured-provider" },
    { ...second, id: "missing-model" },
    { ...second, thinking: "not-a-thinking-level" },
  ]) {
    await assert.rejects(f.select(main, selection), {
      code: "MODEL_UNAVAILABLE",
    });
    assert.deepEqual(f.selection(main), first);
    assert.deepEqual(f.selection(f.create()), first);
  }
  await assert.rejects(f.select(main, { ...second, extra: true }), {
    code: "INVALID_INPUT",
  });
  assert.deepEqual(f.selection(main), first);
  assert.deepEqual(f.selection(f.create()), first);
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

test("model default: unavailable saved default is retained, never substituted, and rejected on send", async (t) => {
  const f = fixture(t);
  const main = f.create();
  await f.select(main, first);
  writeFileSync(f.modelsPath, JSON.stringify({ providers: {} }));
  await f.restart();
  const inherited = f.create();
  assert.deepEqual(f.selection(main), first);
  assert.deepEqual(f.selection(inherited), first);
  await assert.rejects(
    f.agents.command({
      requestId: randomUUID(),
      op: "prompt",
      ...inherited,
      params: { text: "Unavailable default must not launch a worker" },
    }),
    { code: "MODEL_UNAVAILABLE" },
  );
  assert.equal(f.agents.info(inherited).run, null);
  assert.deepEqual(f.selection(f.create()), first);
});
