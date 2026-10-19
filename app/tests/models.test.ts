import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ModelService } from "../src/server/model-service.js";
import { configuration } from "../src/server/models.js";
import { Store } from "../src/server/storage.js";
import { Logins } from "../src/server/auth.js";
import { setTimeout as delay } from "node:timers/promises";
import type { AuthState } from "../src/shared/models.js";
import type { ProviderDraft, ModelDraft } from "../src/shared/models.js";

test("configuration watchers preserve invalidation when TEMP uses a filesystem alias", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-config-watch-"));
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  let close = () => {};
  try {
    const service = new ModelService(root);
    let changes = 0;
    close = service.watchConfiguration(() => { changes++; });
    const changed = async (expected: number) => {
      const deadline = Date.now() + 5000;
      while (changes < expected) {
        assert.ok(Date.now() < deadline, "configuration watcher must deliver the file change");
        await delay(10);
      }
    };
    const models = join(service.dir, "models.json");
    writeFileSync(models, '{"providers":{}}');
    await changed(1);
    const beforeEdit = changes;
    writeFileSync(models, '{ "providers": {} }');
    await changed(beforeEdit + 1);
    const beforeAuth = changes;
    writeFileSync(join(service.dir, "auth.json"), '{}');
    await changed(beforeAuth + 1);
    const beforeDelete = changes;
    rmSync(models);
    await changed(beforeDelete + 1);
  } finally {
    close();
    if (previous === undefined) delete process.env.AXIOM_PI_DIR;
    else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("external receipts: pending recovery never repeats side effects after restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-receipts-"));
  let store = new Store(root);
  const request = {
    requestId: randomUUID(),
    op: "configuration.save",
    params: {},
  };
  let release!: () => void;
  try {
    const first = store.external(request, async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return {};
    });
    assert.equal(store.receipt(request.requestId).status, "pending");
    await assert.rejects(
      store.external(request, async () => assert.fail("must not replay")),
      { code: "UNCERTAIN" },
    );
    release();
    await first;
    // Simulate a process dying after its journal entry, before the final response.
    store.db
      .prepare(
        "UPDATE external_requests SET state='pending',response=NULL WHERE id=?",
      )
      .run(request.requestId);
    store.close();
    store = new Store(root);
    assert.equal(store.receipt(request.requestId).status, "uncertain");
    await assert.rejects(
      store.external(request, async () =>
        assert.fail("must not replay after restart"),
      ),
      { code: "UNCERTAIN" },
    );
    assert.throws(() => store.execute(request), { code: "REQUEST_CONFLICT" });
    store.db.exec(
      "CREATE TEMP TRIGGER fail_receipt BEFORE UPDATE ON external_requests BEGIN SELECT RAISE(ABORT,'disk failure'); END",
    );
    const lost = { ...request, requestId: randomUUID() };
    await assert.rejects(
      store.external(lost, async () => ({})),
      { code: "UNCERTAIN" },
    );
    assert.equal(store.receipt(lost.requestId).status, "pending");
    await assert.rejects(
      store.external(lost, async () =>
        assert.fail("must not replay after receipt failure"),
      ),
      { code: "UNCERTAIN" },
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("shared pi directory: provider-only save survives restart and native credentials supply models", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-shared-"));
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "shared-pi");
  try {
    const service = new ModelService(root);
    const draft = await service.read();
    draft.providers = [{ ...provider(), providerId: "openai", models: [], key: "TEST-ONLY" }];
    await service.save(draft);
    const reloaded = await new ModelService(root).read();
    assert.equal(reloaded.providers[0].providerId, "openai");
    assert.equal(reloaded.providers[0].auth?.configured, true);
    assert.ok((await configuration(root)).available.some((m) => m.provider === "openai"));
    // pi login without a models.json entry must also be usable and editable.
    writeFileSync(join(service.dir, "models.json"), '{"providers":{}}');
    assert.ok((await configuration(root)).available.some((m) => m.provider === "openai"));
    const imported = await service.read();
    assert.equal(imported.providers[0].providerId, "openai");
    await service.save(imported);
    assert.equal((await service.read()).providers[0].auth?.configured, true);
  } finally {
    if (previous === undefined) delete process.env.AXIOM_PI_DIR;
    else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("API key save rejects a login that did not persist a credential", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-missing-credential-"));
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  try {
    const service = new ModelService(root);
    const createRuntime = service.runtime.bind(service);
    service.runtime = async (path) => {
      const runtime = await createRuntime(path);
      runtime.login = async () => ({ type: "api_key", key: "TEST-ONLY-NOT-PERSISTED" });
      return runtime;
    };
    const draft = await service.read();
    draft.providers = [{ ...provider(), key: "TEST-ONLY-NOT-PERSISTED" }];
    await assert.rejects(service.save(draft), { code: "PARTIAL_CONFIG_FAILURE" });
    assert.deepEqual(await (await createRuntime()).listCredentials(), []);
  } finally {
    if (previous === undefined) delete process.env.AXIOM_PI_DIR;
    else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

const model = (id: string): ModelDraft => ({
  key: id,
  id,
  name: id,
  levels: ["none", "high", "max"],
  headers: [],
  body: [],
});
const provider = (): ProviderDraft => ({
  id: "draft",
  providerId: "axiom-config-test",
  name: "测试供应商",
  api: "openai-completions",
  url: "http://127.0.0.1:1/v1",
  key: "",
  headers: [],
  body: [],
  models: [model("one"), model("two")],
});
test("Model configuration: validation, atomic publish, pi credentials, redaction, conflicts and deletion", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "axiom-models-"));
  const previousPi = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  t.after(() => { if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi; });
  const service = new ModelService(root),
    store = new Store(root);
  const path = join(root, "pi", "models.json");
  const key = "TEST-ONLY-LOCAL-KEY",
    header = "HEADER-TEST-ONLY";
  try {
    let draft = await service.read();
    draft.providers = [provider()];
    draft.providers[0].key = key;
    draft.providers[0].headers = [{ id: "h", key: "X-Test", value: header }];
    draft.providers[0].body = [{ id: "b", key: "temperature", value: "0.2" }];
    draft.providers[0].models[0].body = [
      { id: "b", key: "temperature", value: "0.7" },
    ];
    await service.save(draft);
    assert.equal((await configuration(root)).available.length, 2);
    const saved = JSON.parse(readFileSync(path, "utf8"));
    assert.ok(
      !readFileSync(path, "utf8").includes(key),
      "keys must use pi auth, not models.json",
    );
    assert.equal(
      saved.providers["axiom-config-test"].models[0].samplingParams.temperature,
      0.7,
    );
    assert.equal(
      saved.providers["axiom-config-test"].models[1].samplingParams.temperature,
      0.2,
    );
    assert.deepEqual(
      saved.providers["axiom-config-test"].models[0].thinkingLevelMap,
      { minimal: null, low: null, medium: null, xhigh: null, max: "max" },
    );
    draft = await service.read();
    assert.ok(!JSON.stringify(draft).includes(key));
    assert.ok(!JSON.stringify(draft).includes(header));
    assert.equal(draft.providers[0].auth?.type, "api_key");
    assert.equal(draft.providers[0].auth?.source, "stored");
    assert.equal(draft.storage?.authPath, join(root, "pi", "auth.json"));
    assert.equal(draft.storage?.modelsPath, path);
    const persistedKey = () => JSON.parse(readFileSync(join(root, "pi", "auth.json"), "utf8"))["axiom-config-test"]?.key;
    assert.ok(persistedKey() === key, "API key must be written to auth.json");
    draft.providers[0].key = "TEST-ONLY-REPLACEMENT";
    await service.save(draft);
    assert.ok(persistedKey() === "TEST-ONLY-REPLACEMENT", "replacement key must reach disk");
    draft = await new ModelService(root).read();
    assert.equal(draft.providers[0].key, "");
    assert.equal(draft.providers[0].auth?.configured, true);
    await service.save(draft);
    assert.ok(persistedKey() === "TEST-ONLY-REPLACEMENT", "blank input must preserve the saved key");
    assert.equal(
      JSON.parse(readFileSync(path, "utf8")).providers["axiom-config-test"]
        .headers["X-Test"],
      header,
    );
    // A custom definition and a topmost override may coexist; edited values must actually win.
    const layered = JSON.parse(readFileSync(path, "utf8"));
    layered.providers["axiom-config-test"].models[0].headers = {
      "X-Model": "MODEL-PRIVATE",
    };
    layered.providers["axiom-config-test"].modelOverrides = {
      one: {
        name: "Override name",
        samplingParams: { temperature: 0.9 },
        headers: { "X-Model": "LOWER-PRIVATE", "X-Extra": "EXTRA-PRIVATE" },
        contextWindow: 32000,
      },
    };
    writeFileSync(path, JSON.stringify(layered));
    draft = await service.read();
    assert.equal(draft.providers[0].models[0].name, "Override name");
    assert.equal(draft.providers[0].models[0].body[0].value, "0.9");
    draft.providers[0].models[0].name = "Edited name";
    draft.providers[0].models[0].body[0].value = "0.4";
    await service.save(draft);
    const actual = (await service.runtime()).getModel(
      "axiom-config-test",
      "one",
    )!;
    assert.equal(actual.name, "Edited name");
    assert.equal(actual.samplingParams?.temperature, 0.4);
    assert.equal(actual.contextWindow, 32000);
    const auth = await (await service.runtime()).getAuth(actual);
    assert.equal(auth?.auth.headers?.["X-Model"], "MODEL-PRIVATE");
    assert.equal(auth?.auth.headers?.["X-Extra"], "EXTRA-PRIVATE");
    const good = readFileSync(path, "utf8");
    for (const alter of [
      (p: ProviderDraft) => {
        p.url = "https://username:SECRET@example.com/v1";
      },
      (p: ProviderDraft) => {
        p.headers.push({ id: "duplicate", key: "x-test", value: "duplicate" });
      },
      (p: ProviderDraft) => {
        p.headers = [{ id: "h", key: "X-Test", value: "line\r\nbreak" }];
      },
      (p: ProviderDraft) => {
        p.models.push({ ...p.models[0] });
      },
      (p: ProviderDraft) => {
        p.models[0].levels = [];
      },
      (p: ProviderDraft) => {
        p.models[0].body = [{ id: "b", key: "tools", value: "1" }];
      },
      (p: ProviderDraft) => {
        p.api = "anthropic-messages";
      },
      (p: ProviderDraft) => {
        p.key = "••••••";
      },
    ]) {
      const invalid = await service.read();
      alter(invalid.providers[0]);
      await assert.rejects(service.save(invalid), { code: "INVALID_CONFIG" });
      assert.equal(readFileSync(path, "utf8"), good);
    }
    const command = await service.read();
    command.providers[0].headers = [
      { id: "h", key: "X-Test", value: "!this-command-must-not-run" },
    ];
    await assert.rejects(service.save(command), {
      code: "COMMAND_AUTHORIZATION_REQUIRED",
    });
    const commandKey = await service.read();
    commandKey.providers[0].key = "!this-command-must-not-run";
    await assert.rejects(service.save(commandKey), {
      code: "COMMAND_AUTHORIZATION_REQUIRED",
    });
    const concurrent = await service.read();
    const results = await Promise.allSettled([
      service.save({
        ...concurrent,
        providers: concurrent.providers.map((p) => ({ ...p, name: "first" })),
      }),
      service.save(concurrent),
    ]);
    assert.equal(results[0].status, "fulfilled");
    assert.equal(results[1].status, "rejected");
    assert.equal(
      (results[1] as PromiseRejectedResult).reason.code,
      "REVISION_CONFLICT",
    );
    draft = await service.read();
    draft.providers[0].models.pop();
    await assert.rejects(service.save(draft), {
      code: "LOGOUT_CONFIRMATION_REQUIRED",
    });
    await service.save({ ...draft, confirmLogout: true });
    assert.equal((await configuration(root)).modelCount, 1);
    assert.equal((await configuration(root)).available.length, 0);
    assert.deepEqual(await (await service.runtime()).listCredentials(), []);
    assert.deepEqual(
      JSON.parse(readFileSync(path, "utf8")).providers["axiom-config-test"]
        .headers,
      {},
    );

    // Configuration responses and hashes are persisted, never submitted secrets.
    draft = await service.read();
    draft.providers[0].key = key;
    const request = {
      requestId: randomUUID(),
      op: "configuration.save",
      params: draft as unknown as Record<string, unknown>,
    };
    const response = await store.external(request, () => service.save(draft));
    assert.deepEqual(
      await store.external(request, async () => {
        throw Error("must not replay");
      }),
      response,
    );
    await assert.rejects(
      store.external({ ...request, params: {} }, async () => ({})),
      { code: "REQUEST_CONFLICT" },
    );
    assert.ok(
      !JSON.stringify(
        store.db.prepare("SELECT * FROM external_requests").all(),
      ).includes(key),
    );
    const badAuth = readFileSync(join(root, "pi", "auth.json"), "utf8");
    writeFileSync(join(root, "pi", "auth.json"), "{invalid");
    draft.providers[0].name = "partial";
    draft.providers[0].key = key;
    draft.revision = (await service.load()).revision;
    await assert.rejects(service.save(draft), {
      code: "PARTIAL_CONFIG_FAILURE",
    });
    assert.equal(
      JSON.parse(readFileSync(path, "utf8")).providers["axiom-config-test"]
        .name,
      "partial",
    );
    writeFileSync(join(root, "pi", "auth.json"), badAuth);
    // Built-in model additions retain pi metadata, rather than replacing it with custom defaults.
    const runtime = await service.runtime(),
      builtin = runtime.getModels("openai").find((m) => !m.reasoning)!;
    assert.ok(builtin);
    draft = await service.read();
    const template = draft.templates.find((t) => t.id === "openai")!;
    draft.providers.push({
      ...provider(),
      id: "openai-draft",
      providerId: " openai ",
      name: template.name,
      api: template.api,
      url: template.url,
      models: [{ ...model(builtin.id), levels: ["none"] }],
    });
    await service.save(draft);
    const kept = (await service.runtime()).getModel("openai", builtin.id)!;
    assert.deepEqual(kept.cost, builtin.cost);
    assert.deepEqual(kept.input, builtin.input);
    assert.equal(kept.contextWindow, builtin.contextWindow);
    assert.ok(
      JSON.parse(readFileSync(path, "utf8")).providers.openai.modelOverrides[
        builtin.id
      ],
    );
    writeFileSync(path, "{bad-secret-config");
    await assert.rejects(service.save(draft), { code: "CONFIG_READ_FAILED" });
    assert.equal(readFileSync(path, "utf8"), "{bad-secret-config");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("pi auth bridge: owner-bound prompts, OAuth interactions, abort and secret-free events (fixture only)", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "axiom-auth-"));
  const previousPi = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  t.after(() => { if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi; });
  const service = new ModelService(root);
  const states: { owner: object; state: AuthState }[] = [],
    owner = {},
    foreign = {};
  const opened: string[] = [];
  const logins = new Logins(
    service,
    (owner, state) => states.push({ owner, state }),
    async () => {},
    async (url, signal) => { signal.throwIfAborted(); opened.push(url); },
  );
  const until = async (predicate: () => boolean) => {
    for (let n = 0; n < 100 && !predicate(); n++) await delay(10);
    assert.ok(predicate(), "auth transition timed out");
  };
  try {
    await service.save({ ...(await service.read()), providers: [provider()] });
    const runtime = await service.runtime();
    const base = runtime.getProvider("axiom-config-test")!;
    // Register only inside the test runtime. Product code uses pi's real provider-owned flows.
    runtime.registerNativeProvider({
      ...base,
      auth: {
        ...base.auth,
        oauth: {
          name: "fixture OAuth",
          async login(interaction) {
            interaction.notify({
              type: "auth_url",
              url: "https://example.invalid/authorize?state=fixture",
            });
            interaction.notify({
              type: "progress",
              message: "must-not-forward-private-progress",
            });
            const domain = await interaction.prompt({ type: "text", message: "Domain (blank for default)", placeholder: "company.example" });
            assert.equal(domain, "");
            await interaction.prompt({
              type: "select",
              message: "method",
              options: [{ id: "manual", label: "Manual" }],
            });
            const code = await interaction.prompt({
              type: "manual_code",
              message: "code",
            });
            assert.equal(code, "FIXTURE-CODE");
            return {
              type: "oauth",
              access: "FIXTURE-ACCESS-SECRET",
              refresh: "FIXTURE-REFRESH-SECRET",
              expires: Date.now() + 3600000,
            };
          },
          async refresh(credential) {
            return credential;
          },
          async toAuth(credential) {
            return { apiKey: credential.access };
          },
        },
      },
    });
    await runtime.refresh({ allowNetwork: false });
    service.runtime = async () => runtime;
    const revision = (await service.load()).revision;
    const { id } = await logins.start(
      owner,
      "axiom-config-test",
      "oauth",
      revision,
    );
    await until(() => !!logins.get(owner, id).state.prompt);
    assert.throws(() => logins.open(foreign, id), { code: "AUTH_SCOPE_MISMATCH" });
    assert.deepEqual(await logins.open(owner, id), { opened: true });
    assert.deepEqual(opened, ["https://example.invalid/authorize?state=fixture"]);
    await assert.rejects(service.save({ revision, providers: [] }), {
      code: "AUTH_BUSY",
    });
    assert.throws(
      () =>
        logins.answer(
          foreign,
          id,
          logins.get(owner, id).state.prompt!.id,
          "manual",
        ),
      { code: "AUTH_SCOPE_MISMATCH" },
    );
    assert.throws(() => logins.answer(owner, id, logins.get(owner, id).state.prompt!.id, "bad\0input"), { code: "INVALID_INPUT" });
    assert.equal(logins.get(owner, id).state.prompt!.placeholder, "company.example");
    logins.answer(owner, id, logins.get(owner, id).state.prompt!.id, "");
    await until(() => logins.get(owner, id).state.prompt?.type === "select");
    const first = logins.get(owner, id).state.prompt!.id;
    assert.throws(() => logins.answer(owner, id, first, "invalid"), {
      code: "INVALID_INPUT",
    });
    logins.answer(owner, id, first, "manual");
    await until(
      () => logins.get(owner, id).state.prompt?.type === "manual_code",
    );
    assert.throws(() => logins.answer(owner, id, first, "again"), {
      code: "AUTH_STALE_PROMPT",
    });
    logins.answer(
      owner,
      id,
      logins.get(owner, id).state.prompt!.id,
      "FIXTURE-CODE",
    );
    await until(
      () =>
        logins.get(owner, id).state.status === "completed" &&
        !service.authActive,
    );
    assert.throws(() => logins.open(owner, id), { code: "AUTH_EXPIRED" });
    assert.deepEqual(await runtime.listCredentials(), [
      { providerId: "axiom-config-test", type: "oauth" },
    ]);
    assert.ok(states.every((event) => event.owner === owner));
    assert.ok(!JSON.stringify(states).includes("SECRET"));
    assert.ok(!JSON.stringify(states).includes("FIXTURE-CODE"));
    assert.ok(
      !JSON.stringify(states).includes("must-not-forward-private-progress"),
    );
    const cancelled = await logins.start(
      owner,
      "axiom-config-test",
      "oauth",
      revision,
    );
    await until(() => !!logins.get(owner, cancelled.id).state.prompt);
    logins.disconnect(owner);
    await until(() => !service.authActive);
    assert.throws(() => logins.get(owner, cancelled.id), {
      code: "AUTH_SCOPE_MISMATCH",
    });
    assert.deepEqual(
      await runtime.listCredentials(),
      [{ providerId: "axiom-config-test", type: "oauth" }],
      "cancelling login must not delete previous credentials",
    );
    // Disconnect while start is queued: no late prompt, callback server, or credential write.
    let release!: () => void;
    const waiting = service.serial(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await until(() => !!release);
    const lateOwner = {},
      late = logins.start(lateOwner, "axiom-config-test", "oauth", revision);
    logins.disconnect(lateOwner);
    release();
    await waiting;
    await assert.rejects(late, { code: "AUTH_CANCELLED" });
    assert.equal(service.authActive, false);
    const explicit = await logins.start(
      foreign,
      "axiom-config-test",
      "oauth",
      revision,
    );
    await until(() => !!logins.get(foreign, explicit.id).state.prompt);
    await logins.cancel(foreign, explicit.id);
    assert.equal(logins.get(foreign, explicit.id).state.status, "failed");
    assert.equal(service.authActive, false);
  } finally {
    await logins.close();
    rmSync(root, { recursive: true, force: true });
  }
});
