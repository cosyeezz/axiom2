import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configuration } from "../src/server/models.js";

test("model display metadata retains local identity, readable model names and configured/native provider names", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-model-notice-"));
  const previous = process.env.AXIOM_PI_DIR;
  const pi = process.env.AXIOM_PI_DIR = join(root, "pi");
  const copyId = "axiom-copy-4a210b7a-abd9-4611-be62-068b9ae2e65b";
  mkdirSync(pi);
  try {
    writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: {
      openai: { models: [{ id: copyId, axiomRequestModelId: "gpt-6-astra", name: "GPT-6 Astra（复制）" }] },
      "display-fixture": {
        name: "我的供应商", api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1",
        models: [{ id: copyId, axiomRequestModelId: "gpt-6-astra", name: "独立配置" }],
      },
      "unnamed-fixture": {
        api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1",
        models: [{ id: "upstream-model" }],
      },
    } }));
    writeFileSync(join(pi, "auth.json"), JSON.stringify(Object.fromEntries(
      ["openai", "display-fixture", "unnamed-fixture"].map(id => [id, { type: "api_key", key: "TEST-ONLY" }]),
    )));
    const result = await configuration(root);
    assert.equal(result.error, undefined);
    assert.equal(result.available.length, 3);
    const native = result.available.find(m => m.provider === "openai")!;
    assert.equal(native.id, copyId, "display metadata must not change runtime identity");
    assert.equal(native.name, "GPT-6 Astra（复制）");
    assert.equal(native.providerName, "OpenAI");
    const custom = result.available.find(m => m.provider === "display-fixture")!;
    assert.equal(custom.providerName, "我的供应商");
    assert.equal(custom.name, "独立配置");
    const unnamed = result.available.find(m => m.provider === "unnamed-fixture")!;
    assert.equal(unnamed.providerName, "unnamed-fixture");
    assert.equal(unnamed.name, "upstream-model");
    assert.doesNotMatch(JSON.stringify(result), /TEST-ONLY/);
  } finally {
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
