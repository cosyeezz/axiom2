import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { ModelService } from "../src/server/model-service.js";
import { Logins } from "../src/server/auth.js";
import { ensureModelProvider, nativeProviderTemplates } from "../src/server/model-runtime.js";
import { closeModelNetworks } from "../src/server/model-network.js";

const providerId = "qoder-cn";
test("Qoder isolated worker login, signed catalog, reopened settings and snapshot runtime", { timeout: 45000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-qoder-runtime-"));
  const envKeys = ["AXIOM_PI_DIR", "NODE_OPTIONS", "AXIOM_QODER_FIXTURE_DIR", "AXIOM_EXPERIMENTAL_QODER"] as const;
  const previous = envKeys.map(key => process.env[key]), previousFetch = globalThis.fetch;
  const preload = fileURLToPath(new URL("./fixtures/qoder-network.cjs", import.meta.url));
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --require=${JSON.stringify(preload)}`;
  process.env.AXIOM_QODER_FIXTURE_DIR = root; process.env.AXIOM_PI_DIR = join(root, "pi");
  process.env.AXIOM_EXPERIMENTAL_QODER = "1";
  globalThis.fetch = async () => { throw Error("Unexpected parent network request in Qoder fixture"); };
  const service = new ModelService(root), owner = {};
  const logins = new Logins(service, () => {}, async () => {}, async (url) => {
    assert.equal(new URL(url).origin, "https://qoder.com.cn"); writeFileSync(join(root, "browser-opened"), "fixture");
  });
  try {
    const draft = await service.read(), template = draft.templates.find(item => item.id === providerId)!;
    assert.ok(template); assert.deepEqual(template.methods, ["api_key", "oauth"]);
    const runtime = await service.runtime();
    assert.equal(runtime.getRegisteredNativeProvider(providerId), undefined, "templates must be lazy");
    const flow = await logins.start(owner, providerId, "oauth", draft.revision);
    const deadline = Date.now() + 15000;
    while (!logins.get(owner, flow.id).state.url) {
      const state = logins.get(owner, flow.id).state;
      assert.equal(state.status, "running", state.message); assert.ok(Date.now() < deadline, "Login URL timeout"); await delay(10);
    }
    await logins.open(owner, flow.id);
    while (service.authActive) {
      assert.notEqual(logins.get(owner, flow.id).state.status, "failed", logins.get(owner, flow.id).state.message);
      assert.ok(Date.now() < deadline, "Login completion timeout"); await delay(10);
    }
    assert.equal(logins.get(owner, flow.id).state.status, "completed");
    const stored = JSON.parse(readFileSync(join(service.dir, "auth.json"), "utf8"))[providerId];
    assert.equal(stored.access, "dt-FIXTURE"); assert.equal(stored.region, "cn"); assert.ok(stored.machineId);
    const reopened = new ModelService(root), view = await reopened.read();
    assert.equal(view.providers.find(item => item.providerId === providerId)?.auth?.configured, true);
    assert.ok(!JSON.stringify(view).includes("dt-FIXTURE"));
    const catalog = await reopened.catalog(providerId, view.revision);
    assert.equal(catalog.source, "native"); assert.equal(catalog.models.length, 1); assert.equal(catalog.models[0].id, "auto");
    const requests = readFileSync(join(root, "requests.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.ok(requests.some(item => item.path === "/algo/api/v2/model/list"));
    assert.ok(requests.every(item => item.worker === "1"));
    const storedModels = readFileSync(join(service.dir, "models-store.json"), "utf8");
    assert.ok(!storedModels.includes("dt-FIXTURE") && !storedModels.includes("fixture-user") && !storedModels.includes(stored.machineId));
    const snapshotPath = join(root, "snapshot.json");
    writeFileSync(snapshotPath, JSON.stringify({ providers: { [providerId]: { modelOverrides: { auto: { name: "Snapshot Auto" } } } } }));
    const snapshotAuth = readFileSync(join(service.dir, "auth.json"), "utf8");
    const snapshot = await reopened.runtime(snapshotPath), model = snapshot.getModel(providerId, "auto")!;
    assert.equal(readFileSync(join(service.dir, "models-store.json"), "utf8"), storedModels, "offline restore must not rewrite the cache");
    assert.equal(readFileSync(join(service.dir, "auth.json"), "utf8"), snapshotAuth, "offline restore must not rewrite credentials");
    assert.ok(model, "catalog must survive a new runtime"); assert.equal(model.name, "Snapshot Auto");
    const result = await snapshot.completeSimple(model, { messages: [{ role: "user", content: "hello", timestamp: 1 }] }, { fetch: async (input) => {
      const url = new URL(String(input)); assert.equal(url.origin, "https://gateway.qoder.com.cn");
      if (url.pathname.endsWith("endpoints")) return new Response(JSON.stringify({ inferNodes: ["https://gateway.qoder.com.cn"] }));
      if (url.pathname.endsWith("model/list")) return new Response(JSON.stringify({ chat: [{ key: "auto", max_output_tokens: 1024 }] }));
      assert.equal(url.pathname, "/algo/api/v2/service/pro/sse/agent_chat_generation");
      return new Response('data: {"statusCodeValue":200,"body":"{\\"choices\\":[{\\"delta\\":{\\"content\\":\\"ok\\"},\\"finish_reason\\":\\"stop\\"}]}"}\n\ndata: {"statusCodeValue":200,"body":"[DONE]"}\n\n', { headers: { "content-type": "text/event-stream" } });
    } });
    assert.equal(result.stopReason, "stop", result.errorMessage);
    delete process.env.AXIOM_EXPERIMENTAL_QODER;
    await closeModelNetworks(root);
    assert.ok(!nativeProviderTemplates().some(item => item.id === providerId));
    writeFileSync(join(service.dir, "models.json"), JSON.stringify({ providers: { "codebuddy-cn": { headers: {} } } }));
    assert.equal((await reopened.runtime()).getError(), undefined, "disabled credentials must not poison configuration validation");
    const disabledView = await reopened.read();
    assert.ok(disabledView.providers.some(item => item.providerId === "codebuddy-cn"), "disabled Qoder credentials must not block other providers");
    assert.ok(!disabledView.templates.some(item => item.id === providerId));
    await reopened.save({ ...disabledView, providers: disabledView.providers.map(p => ({ ...p, key: "" })) });
    const disabled = await reopened.runtime(snapshotPath);
    assert.equal((await disabled.getAvailable(providerId)).length, 0);
    await assert.rejects(ensureModelProvider(disabled, providerId), /实验性/);
    const denied = await disabled.completeSimple(disabled.getModel(providerId, "auto")!, { messages: [{ role: "user", content: "no network", timestamp: 1 }] }, {
      fetch: async () => { assert.fail("disabled provider must never fetch"); },
    });
    assert.equal(denied.stopReason, "error");
    assert.match(denied.errorMessage!, /关闭|实验性/);
    await snapshot.logout(providerId);
    assert.ok(!(await snapshot.listCredentials()).some(item => item.providerId === providerId));
  } finally {
    await logins.close(); await closeModelNetworks(root); globalThis.fetch = previousFetch;
    envKeys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    rmSync(root, { recursive: true, force: true });
  }
});
