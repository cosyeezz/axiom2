import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ModelAccountService } from "../src/server/model-accounts.js";
import { codexAccountFixture } from "./fixtures/model-accounts-codex.js";

test("real Codex accounts→cache→worker→adapter isolates legacy/A/B despite B being selected and bound", { timeout: 30000 }, async t => {
  const f = await codexAccountFixture(); t.after(f.close);
  process.env.AXIOM_MODEL_ACCOUNT_BINDINGS = JSON.stringify({ "openai-codex": f.slots.B.id });
  const listed = await f.accounts.list(), a = listed.accounts.find(row => row.id === f.slots.A.id)!;
  assert.equal(a.email, "a@example.test"); assert.equal(a.emailSource, "token"); assert.equal(a.plan, "plus");
  assert.ok(listed.accounts.find(row => row.id === f.slots.B.id)!.active);
  const values = await Promise.all(["A", "LEGACY", "B"].map(slot => f.accounts.usage(f.slots[slot as keyof typeof f.slots].id, false)));
  assert.deepEqual(values.map(value => value.account), ["A", "LEGACY", "B"].map(slot => ({ email: `${slot.toLowerCase()}@example.test`, plan: "pro", accountId: `account-${slot}`, subscriptionExpiresAt: Date.parse("2098-06-01T00:00:00Z") })));
  assert.deepEqual(values.map(value => value.metrics.find(metric => metric.kind === "balance")?.balance), ["111.5000", "9.1250", "222.2500"]);
  for (const value of values) {
    assert.equal(value.status, "ready"); assert.equal(value.providerId, "openai-codex");
    const window = value.metrics.find(metric => metric.id === "primary_window")!, spark = value.metrics.find(metric => metric.id === "extra_0_primary_window")!;
    assert.ok(window.kind === "window" && window.allowed === true && window.limitReached === false && window.usedPercent === 37.5 && window.resetsAt! > Date.now());
    assert.ok(spark.kind === "window" && spark.allowed === false && spark.limitReached === true);
    const resets = value.metrics.find(metric => metric.kind === "count")!;
    assert.ok(resets.kind === "count" && resets.count === 3 && resets.expiries?.length === 3);
    assert.ok(!JSON.stringify(value).includes("FIXTURE_PRIVATE"));
  }
  const requests = f.requests(); assert.equal(requests.length, 9);
  for (const slot of ["A", "B", "LEGACY"]) assert.deepEqual(requests.filter(row => row.slot === slot).map(row => row.path).sort(), ["/backend-api/accounts/check/v4-2023-04-27", "/backend-api/wham/rate-limit-reset-credits", "/backend-api/wham/usage"]);
  assert.ok(requests.every(row => row.proxy === "http://codex-fixture.invalid:8080/" && row.worker === "1"));
  const restored = new ModelAccountService(f.models);
  for (let index = 0; index < 3; index++) {
    const slot = (["A", "LEGACY", "B"] as const)[index];
    assert.deepEqual(await restored.usage(f.slots[slot].id, false), values[index], "all safe metadata and reset dates survive independent cache restoration");
    assert.equal(readFileSync(join(f.slots[slot].dir, "auth.json"), "utf8"), f.originals[slot]);
  }
  assert.equal(f.requests().length, 9, "restoration uses each account's cache without new GETs or credential refresh");
});
