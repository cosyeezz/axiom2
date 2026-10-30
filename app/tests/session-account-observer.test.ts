import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeOpenAICodexWebSocketSessions } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { createModelRuntime } from "../src/server/model-runtime.js";
import { createSessionAccountObserver, type AccountRequestProof } from "../src/server/session-account-observer.js";
import { modelCredentialRevision, privateJson, writeAccountIndex, accountDirectory } from "../src/server/model-account-storage.js";

const provider = "openai-codex", sessionId = () => crypto.randomUUID();
const oauth = (id = "A") => ({ type: "oauth" as const, access: `fixture.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: id } })).toString("base64url")}.fixture`, refresh: `FIXTURE_REFRESH_${id}`, accountId: id, expires: Date.now() + 86400000 });
async function fixture(t: TestContext, beforeRuntime?: (value: { dir: string; auth: string; credential: ReturnType<typeof oauth> }) => { modelId?: string } | void) {
  const root = mkdtempSync(join(tmpdir(), "axiom-quota-proof-")), dir = join(root, "pi"); mkdirSync(dir);
  const env = ["AXIOM_PI_DIR", "AXIOM_EXECUTION_PROFILE", "AXIOM_MODEL_ACCOUNT_BINDINGS", "AXIOM_MODEL_PROVIDER"];
  const previous = new Map(env.map(key => [key, process.env[key]])); for (const key of env) delete process.env[key];
  process.env.AXIOM_PI_DIR = dir;
  const auth = join(dir, "auth.json"), credential = oauth();
  privateJson(auth, { [provider]: credential }); privateJson(join(dir, "models.json"), { providers: {} });
  const requests: any[] = [];
  class Socket extends EventTarget {
    readyState = 0;
    constructor(url: string) { super(); assert.match(url, /^wss:\/\/chatgpt[.]com\/backend-api(?:\/alternate)?\/codex\/responses$/); setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); }, 0); }
    send(raw: string) {
      requests.push(JSON.parse(raw));
      setTimeout(() => {
        const id = crypto.randomUUID(), item = { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: "offline fixture", annotations: [] }] };
        for (const value of [{ type: "response.created", response: { id } }, { type: "response.output_item.done", output_index: 0, item },
          { type: "response.completed", response: { id, status: "completed", output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }])
          this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
      }, 0);
    }
    close(code = 1000) { this.readyState = 3; const event = new Event("close"); Object.assign(event, { code, reason: "offline fixture", wasClean: true }); this.dispatchEvent(event); }
  }
  const originalSocket = globalThis.WebSocket; globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  t.mock.method(globalThis, "fetch", async () => assert.fail("quota proof must not add network/auth calls"));
  t.after(() => { closeOpenAICodexWebSocketSessions(); globalThis.WebSocket = originalSocket; for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } rmSync(root, { recursive: true, force: true }); });
  const setup = beforeRuntime?.({ dir, auth, credential });
  const runtime = await createModelRuntime({ authPath: auth, modelsPath: join(dir, "models.json"), modelsStorePath: join(dir, "models-store.json"), providerIds: [provider], allowModelNetwork: false, refreshOnCreate: false });
  const selected = setup?.modelId ? runtime.getModels(provider).find(model => model.id === setup.modelId) : runtime.getModels(provider)[0];
  assert.ok(selected, "fixture's configured model must exist");
  const model = { ...selected }, selection = { provider, id: model.id, thinking: "off" as const }, proofs: AccountRequestProof[] = [];
  const observer = createSessionAccountObserver(runtime, auth, proof => proofs.push(proof)); t.after(observer.restore);
  const send = (options: Parameters<typeof runtime.streamSimple>[2] = {}, original = true, selected = selection, expectedId?: string) => {
    const id = options.sessionId ?? sessionId();
    return observer.observe({ selection: selected, sessionId: expectedId ?? id, originalStream: original, requestId: sessionId(), modelRevision: 0 },
      () => runtime.streamSimple(model, { messages: [{ role: "user", content: "offline fixture", timestamp: 1 }] }, { ...options, sessionId: id }).result());
  };
  return { root, dir, auth, credential, runtime, model, selection, observer, proofs, requests, send };
}

test("real SDK resolves absent apiKey before final headers and payload produce a safe account proof", { timeout: 15000 }, async t => {
  const f = await fixture(t), before = readFileSync(f.auth, "utf8"), order: string[] = [];
  const result = await f.send({ transformHeaders: headers => { order.push("headers"); return { ...headers, accept: "application/json" }; },
    onPayload: payload => { order.push("payload"); assert.equal(f.proofs.length, 0); return { ...(payload as object), instructions: "preserved payload replacement" }; } });
  assert.equal(result.stopReason, "stop"); assert.deepEqual(order, ["headers", "payload"]);
  assert.equal(f.proofs.length, 1);
  const { requestId, ...proof } = f.proofs[0]; assert.match(requestId, /^[a-f0-9-]{36}$/);
  assert.deepEqual(proof, { selection: f.selection, provider, api: "openai-codex-responses", credentialKey: modelCredentialRevision(f.credential), modelRevision: 0 });
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].instructions, "preserved payload replacement");
  assert.equal(readFileSync(f.auth, "utf8"), before);
  assert.doesNotMatch(JSON.stringify(f.proofs), /FIXTURE_REFRESH|fixture[.]|chatgpt_account_id/);
});

test("non-session, replaced stream, logical provider mismatch and overridden credentials or routing cannot prove identity", { timeout: 15000 }, async t => {
  const f = await fixture(t);
  await f.send({ sessionId: sessionId() }, true, f.selection, sessionId());
  await f.send({}, false);
  await f.send({}, true, { ...f.selection, provider: "other" });
  await f.send({ apiKey: oauth("OTHER").access });
  await f.send({ transformHeaders: headers => ({ ...headers, "chatgpt-account-id": "OTHER" }) });
  await f.send({ transformHeaders: headers => ({ ...headers, "x-custom-account": "OTHER" }) });
  f.model.baseUrl = "https://chatgpt.com/backend-api/alternate";
  // The fully local socket can answer alternate paths; account proof must still reject the route.
  await f.send();
  assert.deepEqual(f.proofs, []);
});

test("stored credential changes during a pending payload hook do not lend the new slot to an older request", { timeout: 15000 }, async t => {
  const f = await fixture(t); let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const pending = f.send({ onPayload: async () => { entered(); await gate; } });
  await started; privateJson(f.auth, { [provider]: oauth("B") }); release();
  const result = await pending; assert.equal(result.stopReason, "stop", result.errorMessage); assert.deepEqual(f.proofs, []);
});

test("runtime captures independent A before creation, not the different root or later active B; restoring hooks stops observations", { timeout: 15000 }, async t => {
  const a = crypto.randomUUID(), b = crypto.randomUUID();
  const index = (active: string) => ({ version: 1 as const, active: { [provider]: active }, accounts: [a, b].map(id => ({ id, providerId: provider, label: id === a ? "A" : "B", region: "", createdAt: 1 })) });
  const f = await fixture(t, ({ dir, auth, credential }) => {
    privateJson(auth, { [provider]: oauth("ROOT") });
    for (const [id, value] of [[a, credential], [b, oauth("B")]] as const) { const folder = accountDirectory(dir, id); mkdirSync(folder, { recursive: true }); privateJson(join(folder, "auth.json"), { [provider]: value }); }
    writeAccountIndex(dir, index(a)); process.env.AXIOM_EXECUTION_PROFILE = "fixture-profile"; process.env.AXIOM_MODEL_ACCOUNT_BINDINGS = JSON.stringify({ [provider]: a });
  });
  writeAccountIndex(f.dir, index(b));
  const aPath = join(accountDirectory(f.dir, a), "auth.json"), before = readFileSync(aPath, "utf8");
  assert.equal((await f.send()).stopReason, "stop"); assert.equal(f.proofs[0]?.credentialKey, modelCredentialRevision(f.credential));
  assert.equal(readFileSync(aPath, "utf8"), before); assert.notEqual(f.proofs[0]?.credentialKey, modelCredentialRevision(oauth("ROOT")));
  const authHook = f.runtime.getAuth, streamHook = f.runtime.streamSimple;
  f.observer.restore(); assert.notEqual(f.runtime.getAuth, authHook); assert.notEqual(f.runtime.streamSimple, streamHook);
  await f.send(); assert.equal(f.proofs.length, 1, "restored runtime must not emit proofs");
});

test("gated concurrent same-selection requests only prove the newest physical call", { timeout: 15000 }, async t => {
  const f = await fixture(t); let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const older = f.send({ onPayload: async () => { entered(); await gate; } }); await started;
  try { assert.equal((await f.send()).stopReason, "stop"); assert.equal(f.proofs.length, 1); }
  finally { release(); }
  assert.equal((await older).stopReason, "stop"); assert.equal(f.proofs.length, 1, "older same-model payload cannot recreate a proof");
});

test("abort or restore during pending hooks hides identity without swallowing existing hook errors", { timeout: 15000 }, async t => {
  const f = await fixture(t);
  const header = await f.send({ transformHeaders: () => { throw Error("fixture-header-error"); } });
  assert.equal(header.stopReason, "error"); assert.match(header.errorMessage ?? "", /fixture-header-error/);
  const payload = await f.send({ onPayload: () => { throw Error("fixture-payload-error"); } });
  assert.equal(payload.stopReason, "error"); assert.match(payload.errorMessage ?? "", /fixture-payload-error/);
  for (const action of ["abort", "restore"] as const) {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; }), controller = new AbortController();
    const pending = f.send({ signal: controller.signal, onPayload: async () => { entered(); await gate; } }); await started;
    if (action === "abort") controller.abort(); else f.observer.restore();
    release(); await pending; assert.equal(f.proofs.length, 0);
  }
});

test("native getModels/stream methods and global API replacements are conservatively rejected even if they delegate unchanged", { timeout: 15000 }, async t => {
  const f = await fixture(t), native = f.runtime.getRegisteredNativeProvider(provider)!, global = getApiProvider(f.model.api)!;
  for (const [target, key] of [[native, "stream"], [native, "streamSimple"], [native, "getModels"], [global, "stream"], [global, "streamSimple"]] as const) {
    const original = (target as any)[key];
    const changed = t.mock.method(target as any, key, function (this: unknown, ...args: unknown[]) { return original.apply(this, args); });
    try { assert.equal((await f.send()).stopReason, "stop"); assert.equal(f.proofs.length, 0, `${key} replacement must hide proof`); }
    finally { changed.mock.restore(); }
  }
  assert.equal((await f.send({ transformHeaders: headers => ({ ...headers, authorization: `Bearer ${f.credential.access}`, "chatgpt-account-id": f.credential.accountId }) })).stopReason, "stop");
  assert.equal(f.proofs.length, 1, "unchanged native transport and matching explicit identity headers remain valid");
});

test("configured model copy authenticates its cloned physical model but proves the logical selection", { timeout: 15000 }, async t => {
  const original = getBuiltinModels("openai-codex")[0]!;
  const f = await fixture(t, ({ dir }) => {
    privateJson(join(dir, "models.json"), { providers: { [provider]: { headers: {}, models: [{ ...original, id: "local-proof-copy", axiomRequestModelId: original.id }] } } });
    return { modelId: "local-proof-copy" };
  });
  const result = await f.send(); assert.equal(result.stopReason, "stop", result.errorMessage);
  assert.equal(f.requests[0].model, original.id); assert.equal(result.model, "local-proof-copy");
  assert.equal(f.proofs.length, 1); assert.equal(f.proofs[0].selection.id, "local-proof-copy");
});

test("restore does not overwrite a later owner's public SDK hooks", async t => {
  const f = await fixture(t), auth = f.runtime.getAuth.bind(f.runtime), stream = f.runtime.streamSimple.bind(f.runtime);
  const laterAuth: typeof f.runtime.getAuth = ((...args: any[]) => (auth as any)(...args)) as typeof f.runtime.getAuth;
  const laterStream: typeof f.runtime.streamSimple = (...args) => stream(...args);
  f.runtime.getAuth = laterAuth; f.runtime.streamSimple = laterStream; f.observer.restore();
  assert.equal(f.runtime.getAuth, laterAuth); assert.equal(f.runtime.streamSimple, laterStream);
});
