import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { prepareDraft, validateDraft } from "../src/server/models/draft.js";

const runtime = {
  getModels: () => [],
  getModel: () => undefined,
} as unknown as ModelRuntime;
const provider = () => ({
  providerId: "example-provider",
  name: "示例供应商",
  api: "openai-completions",
  url: "https://api.example.com/v1",
  key: "PRIVATE-API-KEY",
  headers: [],
  body: [],
  models: [{ id: "example-model", name: "示例模型", levels: ["none"], headers: [], body: [] }],
});
const prepare = (p: ReturnType<typeof provider>) =>
  prepareDraft({ providers: [p] }, { providers: {} }, runtime);
const failure = (run: () => unknown, parts: string[], code = "INVALID_CONFIG") => {
  assert.throws(run, (error: any) => {
    assert.equal(error.code, code);
    for (const part of parts) assert.ok(error.message.includes(part), error.message);
    assert.doesNotMatch(error.message, /PRIVATE-|SECRET/);
    return true;
  });
};

test("configuration errors identify provider and URL field without exposing URL credentials", () => {
  const p = provider();
  p.url = "https://username:SECRET@example.com/v1";
  failure(() => prepare(p), ["示例供应商", "example-provider", "接口地址", "凭据"]);
  p.providerId = "";
  failure(() => prepare(p), ["示例供应商", "供应商 ID"], "INVALID_INPUT");
});

test("configuration errors locate model, override row and sampling field", () => {
  const p = provider();
  Object.assign(p.models[0], {
    body: [
      { key: "top_p", value: "0.5" },
      { key: "temperature", value: "PRIVATE-INVALID-VALUE" },
    ],
  });
  failure(() => prepare(p), ["example-provider", "示例模型", "example-model", "请求体覆盖第 2 行", "temperature", "有限数值"]);
  Object.assign(p.models[0], {
    body: [],
    headers: [{ key: "X-Test", value: "PRIVATE-HEADER\nVALUE" }],
  });
  failure(() => prepare(p), ["example-provider", "example-model", "请求头覆盖第 1 行", "请求头值"]);
});

test("provider errors after model validation retain provider scope only", () => {
  const p = provider();
  p.key = "PRIVATE-KEY\n";
  failure(() => prepare(p), ["example-provider", "API 密钥"]);
  assert.throws(() => prepare(p), (error: any) => !error.message.includes("示例模型"));
});

test("configuration location preserves command authorization error code", () => {
  const p = provider();
  Object.assign(p.models[0], { headers: [{ key: "X-Test", value: "!PRIVATE-COMMAND" }] });
  failure(() => prepare(p), ["example-provider", "example-model", "请求头覆盖第 1 行", "明确授权"], "COMMAND_AUTHORIZATION_REQUIRED");
});

test("missing override target identifies exact provider/model and explains how to correct it", () => {
  const p = provider();
  const providers = {
    [p.providerId]: { name: p.name, modelOverrides: { "example-model": { name: "示例模型" } } },
  };
  failure(
    () => validateDraft({ providers: [p] }, providers, new Map(), runtime),
    ["示例供应商", "example-provider", "示例模型", "example-model", "模型 ID", "找不到此模型", "重新添加模型"],
  );
});

test("runtime validation reports actual protocol and thinking levels at the model location", () => {
  const p = provider();
  const { providers } = prepare(p);
  providers[p.providerId].models[0].samplingParams = { temperature: 0.5 };
  const actual = { api: "anthropic-messages", reasoning: false };
  const checked = { getModel: () => actual } as unknown as ModelRuntime;
  failure(() => validateDraft({ providers: [p] }, providers, new Map(), checked),
    ["example-provider", "example-model", "请求体覆盖", "anthropic-messages"]);
  providers[p.providerId].models[0].samplingParams = {};
  p.models[0].levels = ["high"];
  failure(() => validateDraft({ providers: [p] }, providers, new Map(), checked),
    ["example-provider", "example-model", "思考等级", "high", "none"]);
});
