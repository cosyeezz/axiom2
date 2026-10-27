import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { PooledMemoryRunner } from "../src/server/memory-runner.js";
import { selection } from "./memory-purpose-fixture.js";

test("organizer configuration identity ignores unrelated providers, models and catalog refresh metadata", () => {
  const dir = mkdtempSync(join(tmpdir(), "axiom-organizer-config-"));
  const config = { providers: { fixture: { baseUrl: "https://invalid.local", models: [{ id: "fixture", maxTokens: 1000 }, { id: "other", maxTokens: 2000 }], modelOverrides: { fixture: { contextWindow: 10000 }, other: { contextWindow: 20000 } } }, unrelated: { baseUrl: "first" } } };
  const catalog = { fixture: { models: [{ id: "fixture", contextWindow: 10000 }, { id: "other", contextWindow: 20000 }], checkedAt: 1 }, unrelated: { models: [] } };
  const auth = { fixture: { type: "api_key", key: "fixture" }, unrelated: { type: "api_key", key: "first" } };
  let revision = 0;
  const save = () => {
    // Same-length rewrites must invalidate the stat cache even on coarse clocks.
    const stamp = new Date(1700000000000 + ++revision * 1000);
    for (const [name, data] of [["models.json", config], ["models-store.json", catalog], ["auth.json", auth]] as const) {
      const path = join(dir, name); writeFileSync(path, JSON.stringify(data)); utimesSync(path, stamp, stamp);
    }
  };
  const fingerprint = () => PooledMemoryRunner.prototype.configurationKey.call({ models: { dir } } as any, selection);
  try {
    save(); const before = fingerprint();
    config.providers.unrelated.baseUrl = "changed"; config.providers.fixture.models[1].maxTokens++;
    config.providers.fixture.modelOverrides.other.contextWindow++; catalog.fixture.models[1].contextWindow++; catalog.fixture.checkedAt++;
    auth.unrelated.key = "changed"; save(); assert.equal(fingerprint(), before);
    auth.fixture = { key: "fixture", type: "api_key" }; save(); assert.equal(fingerprint(), before, "property order is not an authentication change");
    config.providers.fixture.modelOverrides.fixture.contextWindow++; save(); assert.notEqual(fingerprint(), before);
    const afterCapacity = fingerprint(); auth.fixture.key = "actual-auth-change"; save(); assert.notEqual(fingerprint(), afterCapacity);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
