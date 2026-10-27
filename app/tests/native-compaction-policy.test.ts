import assert from "node:assert/strict";
import { test } from "node:test";
import { SettingsManager, shouldCompact } from "@earendil-works/pi-coding-agent";
import { installNativeCompactionPolicy } from "../src/server/native-compaction-policy.js";

test("Pi native threshold follows 70% of the current model, not fixed or model-specific reserves", async () => {
  const settings = SettingsManager.inMemory({ compaction: { reserveTokens: 31999, keepRecentTokens: 100,
    modelOverrides: { "fixture/chat": { reserveTokens: 1, keepRecentTokens: 200 } } } });
  let model = { provider: "fixture", id: "chat", contextWindow: 32000 };
  installNativeCompactionPolicy(settings, () => model);
  const resolved = settings.getCompactionSettings(model);
  assert.deepEqual(resolved, { enabled: true, reserveTokens: 9600, keepRecentTokens: 200 });
  assert.equal(shouldCompact(22400, 32000, resolved), false);
  assert.equal(shouldCompact(22401, 32000, resolved), true);
  model = { provider: "fixture", id: "large", contextWindow: 200000 };
  assert.equal(settings.getCompactionSettings(model).reserveTokens, 60000);
  model = { provider: "fixture", id: "odd", contextWindow: 101 };
  assert.equal(settings.getCompactionSettings(model).reserveTokens, 31);
  await settings.reload();
  assert.equal(settings.getCompactionSettings(model).reserveTokens, 31, "reload must not remove the host policy");
  assert.equal(settings.getGlobalSettings().compaction?.reserveTokens, 31999, "policy does not persist derived reserves");
  assert.equal(settings.getCompactionSettings({ provider: "other", id: "stale" }).enabled, false);
});

test("native policy preserves Pi's own disable switch and skips unknown model capacity", () => {
  const settings = SettingsManager.inMemory({ compaction: { enabled: false } });
  let model: { provider: string; id: string; contextWindow: number } | undefined = { provider: "fixture", id: "chat", contextWindow: 32000 };
  installNativeCompactionPolicy(settings, () => model);
  assert.equal(settings.getCompactionSettings(model).enabled, false);
  settings.applyOverrides({ compaction: { enabled: true } });
  assert.equal(settings.getCompactionSettings(model).enabled, true);
  for (const capacity of [0, -1, NaN, Infinity]) {
    model = { provider: "fixture", id: "missing", contextWindow: capacity };
    assert.equal(settings.getCompactionSettings(model).enabled, false);
  }
  model = undefined;
  assert.equal(settings.getCompactionSettings().enabled, false);
});
