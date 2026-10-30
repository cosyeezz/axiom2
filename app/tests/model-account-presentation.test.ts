import assert from "node:assert/strict";
import test from "node:test";
import { displayModelAccounts, modelAccountAuthCounts, modelAccountPresentation } from "../src/shared/model-account-presentation.js";
import type { ModelAccount } from "../src/shared/model-accounts.js";

const account = (id: string, providerId: string, type?: ModelAccount["type"]): ModelAccount => ({ id, providerId, type, label: id, region: "", active: false, legacy: false, createdAt: 1 });

test("OpenAI OAuth has an individual subscription display capability, not an inferred paid plan", () => {
  for (const providerId of ["openai", "openai-codex"]) {
    const oauth = account("subscription", providerId, "oauth");
    assert.equal(modelAccountPresentation(oauth).kind, "openai-subscription");
    assert.deepEqual(displayModelAccounts([oauth]), [oauth]);
    assert.deepEqual(displayModelAccounts([account("key", providerId, "api_key")]), []);
    assert.deepEqual(displayModelAccounts([account("missing", providerId)]), []);
  }
});

test("generic providers need at least two authenticated accounts", () => {
  const rows = [account("one", "fixture", "oauth"), account("two", "fixture", "api_key"), account("three", "fixture", "oauth")];
  assert.deepEqual(displayModelAccounts(rows.slice(0, 1)), []);
  assert.deepEqual(displayModelAccounts(rows.slice(0, 2)), rows.slice(0, 2));
  assert.deepEqual(displayModelAccounts(rows), rows);
  assert.equal(modelAccountAuthCounts(rows).get("fixture"), 3);
});

test("missing credentials neither create eligibility nor become display cards", () => {
  const rows = [account("one", "fixture", "oauth"), account("two", "fixture", "api_key"), account("missing", "fixture")];
  assert.equal(modelAccountAuthCounts(rows).get("fixture"), 2);
  assert.deepEqual(displayModelAccounts([rows[0], rows[2]]), []);
  assert.deepEqual(displayModelAccounts(rows), rows.slice(0, 2));
  const authenticated = account("three", "fixture", "oauth");
  assert.deepEqual(displayModelAccounts([...rows, authenticated]), [rows[0], rows[1], authenticated]);
});

test("eligibility is per provider and precedes search filtering", () => {
  const rows = [account("work", "fixture", "oauth"), account("home", "fixture", "api_key"), account("spare", "fixture", "oauth"), account("other", "different", "oauth")];
  const eligible = displayModelAccounts(rows);
  assert.deepEqual(eligible.map(row => row.id), ["work", "home", "spare"]);
  assert.deepEqual(eligible.filter(row => row.label === "work"), [rows[0]]);
  assert.deepEqual(displayModelAccounts([account("subscription", "openai", "oauth"), account("api", "openai", "api_key")]).map(row => row.id), ["subscription", "api"]);
});
