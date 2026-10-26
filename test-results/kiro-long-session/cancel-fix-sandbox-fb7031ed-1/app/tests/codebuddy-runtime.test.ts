import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ModelService } from "../src/server/model-service.js";
import { configuration } from "../src/server/models.js";
import { Logins } from "../src/server/auth.js";
import { fileURLToPath } from "node:url";
import { closeModelNetworks } from "../src/server/model-network.js";

const providerId = "codebuddy-cn";
test("CodeBuddy is built in across login, reopened settings, catalog, configuration and snapshot runtimes", { timeout: 60000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-codebuddy-runtime-"));
  const previous = process.env.AXIOM_PI_DIR;
  const previousNodeOptions = process.env.NODE_OPTIONS;
  const previousFixture = process.env.AXIOM_CODEBUDDY_FIXTURE_DIR;
  const previousFetch = globalThis.fetch;
  // Login now runs in a child process. Install a fail-closed transport there as well as here.
  const preload = fileURLToPath(new URL("./fixtures/codebuddy-network.cjs", import.meta.url));
  process.env.NODE_OPTIONS = `${previousNodeOptions ?? ""} --require=${JSON.stringify(preload)}`;
  process.env.AXIOM_CODEBUDDY_FIXTURE_DIR = root;
  globalThis.fetch = async () => { throw new Error("Unexpected parent network request in CodeBuddy fixture"); };
  process.env.AXIOM_PI_DIR = join(root, "pi");
  const service = new ModelService(root);
  const owner = {};
  let opened = "", changed = 0;
  const logins = new Logins(service, () => {}, async () => { changed++; }, async (url) => {
    opened = url;
    writeFileSync(join(root, "browser-opened"), "fixture");
  });
  try {
    const draft = await service.read();
    const template = draft.templates.find(item => item.id === providerId)!;
    assert.equal(template.name, "CodeBuddy 国内版");
    assert.ok(template.methods);
    assert.ok(template.methods.includes("oauth"));
    assert.equal(template.url, "https://copilot.tencent.com/v2");
    const runtime = await service.runtime();
    assert.equal(runtime.getModels(providerId).length, 0, "showing the add-provider template must not initialize CodeBuddy");
    assert.equal(runtime.getRegisteredNativeProvider(providerId), undefined);
    assert.equal((await runtime.getAvailable(providerId)).length, 0);
    const flow = await logins.start(owner, providerId, "oauth", draft.revision);
    const loginDeadline = Date.now() + 15000;
    while (!logins.get(owner, flow.id).state.url) {
      const state = logins.get(owner, flow.id).state;
      assert.equal(state.status, "running", `Login ended before URL notification: ${state.status}; ${state.message}`);
      assert.ok(Date.now() < loginDeadline, `Login URL notification timed out: ${state.status}; ${state.message}`);
      await delay(10);
    }
    assert.equal(logins.get(owner, flow.id).state.url, "https://copilot.tencent.com/login?fixture");
    await logins.open(owner, flow.id);
    const completionDeadline = Date.now() + 15000;
    while (service.authActive) {
      const state = logins.get(owner, flow.id).state;
      assert.notEqual(state.status, "failed", `Login failed: ${state.message}`);
      assert.ok(Date.now() < completionDeadline, `Login completion timed out: ${state.status}; ${state.message}`);
      await delay(10);
    }
    assert.equal(logins.get(owner, flow.id).state.status, "completed");
    const requests = readFileSync(join(root, "requests.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.ok(requests.some(request => request.path === "/v2/plugin/auth/token"));
    assert.ok(requests.every(request => request.worker === "1"));
    assert.equal(changed, 1);
    assert.equal(opened, "https://copilot.tencent.com/login?fixture");
    const stored = JSON.parse(readFileSync(join(service.dir, "auth.json"), "utf8"))[providerId];
    assert.equal(stored.access, "FIXTURE-ACCESS");
    assert.equal(stored.refresh, "FIXTURE-REFRESH");
    assert.equal(await service.raw(), '{"providers":{}}');

    const reopened = new ModelService(root);
    const view = await reopened.read();
    const entry = view.providers.find(item => item.providerId === providerId)!;
    assert.equal(entry.connectionType, "oauth");
    assert.equal(entry.auth?.configured, true);
    assert.equal(entry.hasConnectionOverrides, false);
    assert.ok(!JSON.stringify(view).includes("FIXTURE-ACCESS"));
    const catalog = await reopened.catalog(providerId, view.revision);
    assert.equal(catalog.source, "native");
    assert.equal(catalog.models.length, 11);
    assert.match(catalog.message, /未向供应商查询实时列表/);
    const configured = await configuration(root);
    assert.equal(configured.error, undefined);
    assert.equal(configured.available.filter(item => item.provider === providerId).length, 11);

    const snapshotPath = join(root, "snapshot.json");
    writeFileSync(snapshotPath, JSON.stringify({ providers: { [providerId]: { modelOverrides: { "glm-5.2": { name: "Snapshot name", contextWindow: 64000 } } } } }));
    const snapshot = await reopened.runtime(snapshotPath);
    assert.equal(snapshot.getError(), undefined);
    const model = snapshot.getModel(providerId, "glm-5.2")!;
    assert.equal(model.name, "Snapshot name");
    assert.equal(model.contextWindow, 64000);
    const result = await snapshot.completeSimple(model, { messages: [{ role: "user", content: "hello", timestamp: 1 }] }, {
      maxRetries: 0, fetch: async (_url, init) => {
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer FIXTURE-ACCESS");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.stream, true);
        assert.equal(body.store, undefined);
        return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
      },
    });
    assert.equal(result.stopReason, "stop", result.errorMessage);
    await snapshot.logout(providerId);
    assert.equal((await configuration(root)).available.filter(item => item.provider === providerId).length, 0);
  } finally {
    await logins.close();
    await closeModelNetworks(root);
    globalThis.fetch = previousFetch;
    if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousNodeOptions;
    if (previousFixture === undefined) delete process.env.AXIOM_CODEBUDDY_FIXTURE_DIR;
    else process.env.AXIOM_CODEBUDDY_FIXTURE_DIR = previousFixture;
    if (previous === undefined) delete process.env.AXIOM_PI_DIR;
    else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
