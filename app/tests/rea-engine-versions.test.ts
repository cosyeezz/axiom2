import assert from "node:assert/strict";
import { test } from "node:test";
import { compareEngineVersions, engineDownloadSatisfied, engineRecommendationSatisfied, type ReaEngineState } from "../src/shared/rea-engines.js";

const hopper: ReaEngineState = { id: "hopper", path: "/Applications/Hopper Disassembler.app/Contents/MacOS/hopper", configured: false, status: "detected", detail: "", installable: false, version: "6.6.0-demo", recommendedVersion: "6.6.0", download: { version: "6.6.0", path: "/fixture/package.dmg" } };

test("Hopper public demo matches its official version without proving licensing or compatibility", () => {
  assert.equal(engineRecommendationSatisfied(hopper), true);
  assert.equal(engineDownloadSatisfied(hopper), true);
  assert.equal(engineRecommendationSatisfied({ ...hopper, download: undefined }), true);
  assert.equal(hopper.version, "6.6.0-demo", "preserve the exact locally detected version");
  assert.equal(compareEngineVersions("6.6.0-demo", "6.6.0"), undefined, "generic comparison stays strict");
  assert.equal(engineRecommendationSatisfied({ ...hopper, version: "6.6.0" }), true);
  assert.equal(engineRecommendationSatisfied({ ...hopper, recommendedVersion: "6.6.1" }), false);
  assert.equal(engineRecommendationSatisfied({ ...hopper, available: { version: "6.6.1", token: "new", url: "https://www.hopperapp.com", checkedAt: 1, mode: "download" } }), false);
});

test("Hopper demo equivalence does not relax prereleases, other engines or failed detection", () => {
  for (const version of ["6.6.0-beta", "6.6.0-demo.extra", "6.6.0-demo-demo", "6.6-demo", "6.6.0-DEMO", "invalid", undefined]) {
    assert.equal(engineRecommendationSatisfied({ ...hopper, version }), false, String(version));
  }
  for (const id of ["java", "ghidra", "jadx", "wabt"] as const) assert.equal(engineRecommendationSatisfied({ ...hopper, id }), false, id);
  for (const status of ["missing", "error", "incompatible", "unsupported"] as const) assert.equal(engineRecommendationSatisfied({ ...hopper, status }), false, status);
  assert.equal(engineRecommendationSatisfied({ ...hopper, recommendedVersion: undefined }), false);
  assert.equal(engineRecommendationSatisfied({ ...hopper, id: "java", version: "21.0.13+9-LTS", recommendedVersion: "21.0.13+9.0.LTS" }), true);
});
