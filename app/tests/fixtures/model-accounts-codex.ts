import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ModelService } from "../../src/server/model-service.js";
import { ModelAccountService } from "../../src/server/model-accounts.js";
import { privateJson } from "../../src/server/model-account-storage.js";
import { closeModelNetworks } from "../../src/server/model-network.js";

export async function codexAccountFixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-codex-accounts-")), dir = join(root, "pi"); mkdirSync(dir);
  const keys = ["AXIOM_PI_DIR", "AXIOM_EXECUTION_PROFILE", "AXIOM_MODEL_ACCOUNT_BINDINGS", "AXIOM_MODEL_PROVIDER", "NODE_OPTIONS", "AXIOM_CODEX_FIXTURE_DIR"];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  for (const key of keys.slice(0, 4)) delete process.env[key];
  process.env.AXIOM_PI_DIR = dir; process.env.AXIOM_CODEX_FIXTURE_DIR = root;
  process.env.NODE_OPTIONS = `${previous.get("NODE_OPTIONS") ?? ""} --require=${resolve("tests/fixtures/model-accounts-codex-network.cjs")}`;
  const credentials = Object.fromEntries(["LEGACY", "A", "B"].map(slot => {
    const payload = { ...(slot !== "B" ? { email: `${slot.toLowerCase()}@example.test` } : {}), "https://api.openai.com/auth": { chatgpt_account_id: `account-${slot}`, chatgpt_plan_type: "plus" } };
    return [slot, { type: "oauth" as const, access: `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.FIXTURE_PRIVATE_SIGNATURE`, refresh: "FIXTURE_PRIVATE_REFRESH", accountId: `account-${slot}`, expires: Date.now() + 3600000 }];
  }));
  privateJson(join(root, "network-fixture.json"), { tokens: Object.fromEntries(Object.entries(credentials).map(([slot, credential]) => [credential.access, { slot, account: credential.accountId, balance: slot === "A" ? "111.5000" : slot === "B" ? "222.2500" : "9.1250" }])) });
  privateJson(join(dir, "auth.json"), { "openai-codex": credentials.LEGACY });
  privateJson(join(dir, "models.json"), { providers: { "openai-codex": { headers: {}, axiomProxy: { mode: "external", url: "http://codex-fixture.invalid:8080" } } } });
  const models = new ModelService(root), accounts = new ModelAccountService(models);
  const legacy = (await accounts.list()).accounts[0];
  const rows = { LEGACY: { id: legacy.id, dir } };
  for (const slot of ["A", "B"] as const) {
    const staged = accounts.prepare("openai-codex", { label: `Codex ${slot}`, region: slot }); await accounts.configure(staged);
    privateJson(join(staged.dir, "auth.json"), { "openai-codex": credentials[slot] }); await accounts.commit(staged, "oauth");
    Object.assign(rows, { [slot]: { id: staged.id, dir: staged.dir } });
  }
  const slots = rows as Record<"LEGACY" | "A" | "B", { id: string; dir: string }>;
  await accounts.activate(slots.B.id, (await accounts.list()).revision);
  const originals = Object.fromEntries(Object.entries(slots).map(([slot, value]) => [slot, readFileSync(join(value.dir, "auth.json"), "utf8")]));
  const requests = () => existsSync(join(root, "codex-requests.jsonl")) ? readFileSync(join(root, "codex-requests.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line) as { slot: string; path: string; proxy: string; worker: string }) : [];
  // Exercise the same metadata/config validation as the real settings page, not only the quota adapter.
  await models.read();
  return { root, dir, models, accounts, slots, originals, requests, close: async () => {
    await closeModelNetworks(root);
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(root, { recursive: true, force: true });
  } };
}
