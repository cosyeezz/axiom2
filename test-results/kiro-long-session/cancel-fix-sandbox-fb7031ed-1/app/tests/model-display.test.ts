import assert from "node:assert/strict";
import { test } from "node:test";
import { modelDisplay } from "../src/shared/model-display.js";
import type { ModelSummary } from "../src/shared/protocol.js";

const id = "axiom-copy-4a210b7a-abd9-4611-be62-068b9ae2e65b";
const available: ModelSummary[] = [
  { provider: "openai", providerName: "我的 OpenAI", id, name: "GPT 可读名称", levels: ["off"] },
  { provider: "other", providerName: "另一供应商", id, name: "不能串用", levels: ["off"] },
];
test("model presentation resolves exact provider and config identity without modifying them", () => {
  const identity = { provider: "openai", id };
  assert.deepEqual(modelDisplay(available, identity), { model: "GPT 可读名称", provider: "我的 OpenAI", label: "我的 OpenAI / GPT 可读名称" });
  assert.equal(modelDisplay(available, { ...identity, provider: "other" }).model, "不能串用");
  assert.deepEqual(identity, { provider: "openai", id });
});
test("missing metadata never exposes copied/generated internal UUIDs or guesses another provider", () => {
  for (const missing of [id, "axiom-model-removed"]) {
    assert.equal(modelDisplay([], { provider: "openai", id: missing }).model, "未知模型配置");
    assert.equal(modelDisplay(available, { provider: "missing", id: missing }).model, "未知模型配置");
  }
  assert.deepEqual(modelDisplay(available, { provider: "openai", id: "gpt-upstream" }), {
    model: "gpt-upstream", provider: "我的 OpenAI", label: "我的 OpenAI / gpt-upstream",
  });
  assert.deepEqual(modelDisplay([], { provider: null, id: null }), {
    model: "模型未记录", provider: "供应商未记录", label: "供应商未记录 / 模型未记录",
  });
});
test("blank or accidentally internal display names use the safe fallback", () => {
  for (const name of ["", "  ", id]) {
    assert.equal(modelDisplay([{ ...available[0], name }], { provider: "openai", id }).model, "未知模型配置");
  }
});
