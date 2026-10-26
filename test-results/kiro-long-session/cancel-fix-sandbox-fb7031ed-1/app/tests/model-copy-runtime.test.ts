import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, type Api, type Model, type Context, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { installModelCopies } from "../src/server/model-copies.js";
import { prepareDraft, levelsOf } from "../src/server/models/draft.js";
import { codeBuddyModels } from "../src/server/providers/codebuddy-models.js";
import { copyModelDraft } from "../src/client/models/copy-model.js";
import type { ProviderDraft } from "../src/shared/models.js";

for (const api of ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"] as const) {
  test(`${api} copies preserve local identity, model-scoped auth and signed multi-turn history`, async () => {
    const root = mkdtempSync(join(tmpdir(), "axiom-copy-runtime-")), path = join(root, "models.json");
    writeFileSync(path, JSON.stringify({ providers: { fixture: { models: [{ id: "copy-one", axiomRequestModelId: "upstream" }, { id: "copy-two", axiomRequestModelId: "upstream" }] } } }));
    const model: Model<Api> = { id: "copy-one", name: "副本", provider: "fixture", api, baseUrl: "http://127.0.0.1:1", reasoning: true, input: ["text"], contextWindow: 1000, maxTokens: 100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    const previous: AssistantMessage = {
      role: "assistant", provider: model.provider, api, model: "copy-two", timestamp: 1, stopReason: "toolUse",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      content: [{ type: "thinking", thinking: "private reasoning", thinkingSignature: "SIGNED-THINKING" }, { type: "toolCall", id: "call1", name: "read", arguments: {}, thoughtSignature: "SIGNED-TOOL" }],
    };
    const context: Context = { messages: [previous, { role: "toolResult", toolCallId: "call1", toolName: "read", content: [{ type: "text", text: "result" }], isError: false, timestamp: 2 }] };
    const snapshot = structuredClone(context);
    let captured: Context | undefined, authIdentity: string | undefined, requestIdentity: string | undefined;
    const fake = {
      refresh: async () => ({ aborted: false, errors: new Map() }),
      getAuth: async (input: Model<Api>) => { authIdentity = input.id; return undefined; },
      stream: (input: Model<Api>, history: Context) => {
        requestIdentity = input.id;
        captured = history;
        void fake.getAuth(input);
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "start", partial: { ...previous, model: input.id } });
        stream.push({ type: "done", reason: "stop", message: { ...previous, model: input.id, stopReason: "stop" } });
        return stream;
      },
      streamSimple: (input: Model<Api>, history: Context) => fake.stream(input, history),
      streamDeferred: (input: Model<Api>) => fake.stream(input, context),
      cancelDeferred: async (input: Model<Api>) => { requestIdentity = input.id; await fake.getAuth(input); },
    };
    try {
      installModelCopies(fake as unknown as ModelRuntime, path);
      for (const start of [fake.stream, fake.streamSimple]) {
        const result = await start(model, context).result();
        assert.equal(requestIdentity, "upstream");
        assert.equal(authIdentity, "copy-one");
        assert.equal(result.model, "copy-one");
        const replay = captured!.messages[0] as AssistantMessage;
        assert.equal(replay.model, "upstream");
        assert.deepEqual(replay.content, previous.content, "signed content survives replay");
        assert.deepEqual(context, snapshot, "stored history is not mutated");
        assert.deepEqual(captured!.messages[1], context.messages[1]);
      }
      assert.equal((await fake.streamDeferred(model).result()).model, "copy-one");
      await fake.cancelDeferred(model);
      assert.equal(requestIdentity, "upstream");
      assert.equal(authIdentity, "copy-one");
      writeFileSync(path, JSON.stringify({ providers: { fixture: { models: [{ id: "copy-one", axiomRequestModelId: "changed-upstream" }] } } }));
      await fake.refresh();
      await fake.stream(model, context).result();
      assert.equal(requestIdentity, "changed-upstream", "refresh updates request mapping");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("copying a native model preserves built-in headers with case-insensitive explicit override precedence", () => {
  const native = codeBuddyModels()[0];
  assert.ok(native.headers && Object.keys(native.headers).length);
  const p: ProviderDraft = {
    id: native.provider, originalId: native.provider, providerId: native.provider, name: "native", connectionType: "oauth", api: native.api, url: native.baseUrl,
    key: "", headers: [], body: [], models: [{ key: native.id, originalId: native.id, id: native.id, name: native.name, levels: levelsOf(native), input: [...native.input], cost: { ...native.cost }, headers: [{ id: "h", key: "x-product", source: "x-product", keep: true, value: "" }], body: [] }],
  };
  const copy = copyModelDraft(p.models[0], p.models);
  p.models.push(copy);
  const config = { providers: { [p.providerId]: { modelOverrides: { [native.id]: { headers: { "x-product": "EXPLICIT-OVERRIDE" } } } } } };
  const runtime = { getModel: () => native, getModels: () => [native], getProvider: () => ({ auth: { oauth: { login: () => {} } } }) } as unknown as ModelRuntime;
  const saved = prepareDraft({ providers: [p] }, config, runtime).providers[p.providerId].models.find((m: { id: string }) => m.id === copy.configId);
  const headers = Object.fromEntries(Object.entries(saved.headers).map(([key, value]) => [key.toLowerCase(), value]));
  assert.equal(headers["x-product"], "EXPLICIT-OVERRIDE");
  for (const [key, value] of Object.entries(native.headers!)) if (key.toLowerCase() !== "x-product") assert.equal(headers[key.toLowerCase()], value);
  assert.equal(Object.keys(saved.headers).filter(key => key.toLowerCase() === "x-product").length, 1);
  assert.equal(saved.axiomRequestModelId, native.id);

  // A catalog model can be duplicated before either row has been saved.
  delete p.originalId;
  delete p.models[0].originalId;
  p.models[0].headers = [];
  p.models = [p.models[0]];
  const unsavedCopy = copyModelDraft(p.models[0], p.models);
  p.models.push(unsavedCopy);
  const fresh = prepareDraft({ providers: [p] }, { providers: {} }, runtime).providers[p.providerId].models[0];
  assert.equal(fresh.id, unsavedCopy.configId);
  assert.equal(fresh.contextWindow, native.contextWindow);
  assert.equal(fresh.maxTokens, native.maxTokens);
  assert.deepEqual(fresh.input, native.input);
  assert.deepEqual(fresh.headers, native.headers);
});
