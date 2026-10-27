import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rewriteFixture, until } from "./rewrite-fixture.js";
import { configuration } from "../src/server/models.js";
import { invalidModelDefinition } from "../src/server/model-runtime.js";
import type { Session } from "../src/shared/protocol.js";

test("definition validation never reads credentials or cached availability", async () => {
  const f = await rewriteFixture();
  try {
    const auth = join(f.root, "pi", "auth.json"), cache = join(f.root, "pi", "models-store.json");
    writeFileSync(auth, "{ unreadable credential document");
    writeFileSync(cache, "{ unreadable catalog document");
    assert.equal(await invalidModelDefinition(join(f.root, "pi", "models.json"), f.selection.provider), false);
    assert.equal(readFileSync(auth, "utf8"), "{ unreadable credential document");
    assert.equal(readFileSync(cache, "utf8"), "{ unreadable catalog document");
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test("a broken neighbouring provider cannot hide, send-block or fork-block a healthy selection", { timeout: 30000 }, async () => {
  const f = await rewriteFixture();
  try {
    const path = join(f.root, "pi", "models.json"), config = JSON.parse(readFileSync(path, "utf8"));
    config.providers.broken = { api: 123, models: "invalid PRIVATE_CONFIG_CANARY" };
    writeFileSync(path, JSON.stringify(config));
    const authPath = join(f.root, "pi", "auth.json"), auth = JSON.parse(readFileSync(authPath, "utf8"));
    auth.broken = { type: "not-a-credential" };
    writeFileSync(authPath, JSON.stringify(auth));
    const directory = await configuration(f.root);
    assert.ok(directory.available.some(model => model.provider === f.selection.provider));
    assert.equal(directory.error, undefined);
    assert.ok(directory.warning);
    assert.equal(JSON.stringify(directory).includes("PRIVATE_CONFIG_CANARY"), false);
    await f.call("prompt", { text: "HEALTHY_PARENT" }); await f.idle();
    assert.equal(f.app.agents.info(f.scope).run?.status, "completed");
    const branch = await f.call("agent.fork", { draft: { text: "FORK_DRAFT", attachment: null } }) as Session;
    const scope = { ...f.scope, sessionId: branch.id };
    await f.call("prompt", { text: "HEALTHY_BRANCH" }, scope); await f.idle(scope);
    assert.equal(f.app.agents.info(scope).run?.status, "completed");
    assert.equal(f.requests.length, 2);
  } finally { await f.close(); }
});

test("configuration changes after capture neither block a request nor use a new endpoint behind its back", { timeout: 30000 }, async () => {
  const f = await rewriteFixture();
  try {
    const prepare = f.app.agents.profiles.prepareAsync.bind(f.app.agents.profiles);
    f.app.agents.profiles.prepareAsync = async (...args) => {
      const environment = await prepare(...args);
      writeFileSync(join(f.root, "pi", "models.json"), "{ partially written configuration");
      writeFileSync(join(f.root, "pi", "models-store.json"), "{ partially written catalog");
      assert.equal(environment.current(false), true);
      return environment;
    };
    await f.call("prompt", { text: "CAPTURED_REQUEST" }); await f.idle();
    assert.equal(f.app.agents.info(f.scope).run?.status, "completed");
    assert.equal(f.requests.length, 1);
    assert.match(JSON.stringify(f.requests[0]), /CAPTURED_REQUEST/);
  } finally { await f.close(); }
});

test("cold resource reload works while the selected model configuration is invalid", { timeout: 30000 }, async () => {
  const f = await rewriteFixture();
  try {
    writeFileSync(join(f.root, "pi", "models.json"), "{ broken PRIVATE_RELOAD_CONFIG");
    f.app.agents.models.prepareAuth = async () => assert.fail("resource reload must not prepare model authentication");
    await f.call("agent.reload");
    await until(() => !f.app.agents.reloads.active(f.scope), "resource reload did not settle");
    assert.equal(f.app.agents.reloads.state(f.scope)?.status, "completed");
    assert.equal(f.requests.length, 0);
    assert.equal(f.app.agents.info(f.scope).run, null);
    // A subsequent real prompt may fail for its own invalid configuration, but
    // it must be accepted as a request, not rejected by a global availability gate.
    await f.call("prompt", { text: "LOCAL_MODEL_ERROR" }); await f.idle();
    assert.equal(f.app.agents.info(f.scope).run?.status, "failed");
    assert.notEqual(f.app.agents.info(f.scope).run?.reasonCode, "BINDING_REJECTED");
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});
