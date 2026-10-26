import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/storage.js";
import { Agents } from "../src/server/agents.js";
import { ModelService } from "../src/server/model-service.js";
import { Tasks } from "../src/server/tasks.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
import { defaultBudgets, taskPreferencesScope } from "../src/shared/tasks.js";

const selection = { provider: "task-settings-fixture", id: "fixture", thinking: "high" } as const;
test("global subagent preferences: partial patches, validation, subscriptions, inheritance and restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-task-preferences-"));
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  mkdirSync(process.env.AXIOM_PI_DIR);
  writeFileSync(join(process.env.AXIOM_PI_DIR, "models.json"), JSON.stringify({ providers: {
    [selection.provider]: { api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [{ id: selection.id, reasoning: true }] },
  } }));
  writeFileSync(join(process.env.AXIOM_PI_DIR, "auth.json"), JSON.stringify({ [selection.provider]: { type: "api_key", key: "fixture" } }));
  let store = new Store(root);
  const events: { scope: string; data: unknown }[] = [];
  let agents = new Agents(store, new ModelService(root), (scope, data) => { events.push({ scope, data }); });
  let tasks = new Tasks(agents);
  const restart = async () => {
    await tasks.close(); store.close(); store = new Store(root);
    agents = new Agents(store, new ModelService(root), (scope, data) => { events.push({ scope, data }); });
    tasks = new Tasks(agents);
  };
  const save = (params: Record<string, unknown>, requestId = randomUUID()) => tasks.command({ op: "task.preferences.save", params, requestId });
  const create = (name: string) => {
    const path = join(root, name); mkdirSync(path);
    const workspace = store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path, authorized: true } }) as Workspace;
    const session = store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id }) as Session;
    return { workspaceId: workspace.id, sessionId: session.id };
  };
  try {
    const a = create("a"), b = create("b");
    assert.deepEqual(await tasks.command({ op: "task.preferences.get", requestId: randomUUID() }), { budgets: defaultBudgets, selection: null });
    const old = randomUUID();
    await save({ selection }, old);
    await Promise.all([save({ budgets: { concurrency: 2 } }), save({ budgets: { workMs: 123000 } })]);
    assert.deepEqual(tasks.settings(), { selection, budgets: { concurrency: 2, workMs: 123000 } });
    assert.deepEqual(tasks.list(a).defaultModel, selection);
    assert.deepEqual(tasks.list(b).defaultModel, selection);
    assert.deepEqual(agents.info(a).selection, null, "subagent preference never changes parent model");
    assert.ok(events.some((e) => e.scope === taskPreferencesScope));
    for (const params of [{ budgets: { concurrency: 0 } }, { budgets: { workMs: 999 } }, { budgets: { other: 1 } }, { selection: { ...selection, thinking: "invalid" } }, { selection: { ...selection, extra: true } }])
      await assert.rejects(save(params));
    assert.deepEqual(tasks.settings().selection, selection);
    await restart();
    assert.deepEqual(tasks.settings(), { selection, budgets: { concurrency: 2, workMs: 123000 } });
    await save({ selection: null });
    await save({ selection }, old);
    assert.equal(tasks.settings().selection, null, "old receipt cannot restore old model");
    await restart();
    assert.equal(tasks.list(a).defaultModel, null);
    assert.equal(tasks.list(b).defaultModel, null);
  } finally {
    await tasks.close(); store.close();
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("legacy per-session defaults migrate once without reviving an explicitly cleared global preference", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-task-migration-"));
  const store = new Store(root);
  try {
    const workspace = store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: root, authorized: true } }) as Workspace;
    const session = store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id }) as Session;
    store.db.prepare("INSERT INTO task_parents(sessionId,defaultModel) VALUES(?,?)").run(session.id, JSON.stringify(selection));
    assert.deepEqual(new TaskRecords(store).settings().selection, selection);
    store.db.exec("UPDATE task_model_preferences SET selection=NULL WHERE id=1");
    assert.equal(new TaskRecords(store).settings().selection, null);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
