import assert from "node:assert/strict";
import { test } from "node:test";
import type { OAuthCredential } from "@earendil-works/pi-ai";
import { parseCodeBuddyAccounts } from "../src/native-providers/codebuddy/account-info.js";
import { queryCodeBuddyUsage } from "../src/server/providers/codebuddy-usage.js";
import { publicUsage } from "../src/server/provider-usage-cache.js";
import { supportsProviderUsage } from "../src/server/provider-usage.js";

const signal = () => AbortSignal.timeout(5000);
const credential: OAuthCredential = { type: "oauth", access: "PRIVATE-ACCESS", refresh: "PRIVATE-R", expires: Date.now() + 3600_000 };
const envelope = (accounts: unknown[]) => Response.json({ code: 0, data: { accounts } });

test("CodeBuddy card reads only the CLI account list and shows edition without quota", async () => {
  assert.ok(supportsProviderUsage("codebuddy-cn"));
  const calls: { url: string; init?: RequestInit }[] = [];
  const usage = await queryCodeBuddyUsage("codebuddy-cn", credential, signal(), async (url, init) => {
    calls.push({ url: String(url), init });
    return envelope([{ uid: "PRIVATE-UID", type: "personal", pluginEnabled: true, lastLogin: true, nickname: "PRIVATE-NICK" }]);
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://copilot.tencent.com/v2/plugin/accounts");
  assert.equal(calls[0].init?.method, "GET"); assert.equal(calls[0].init?.redirect, "error");
  assert.equal(new Headers(calls[0].init?.headers).get("authorization"), "Bearer PRIVATE-ACCESS");
  assert.equal(usage.status, "ready"); assert.equal(usage.accountStatus?.state, "active"); assert.equal(usage.refreshable, false);
  assert.deepEqual(usage.account, { plan: "个人版" }); assert.deepEqual(usage.metrics, []);
  assert.match(usage.message!, /未提供额度/);
  assert.ok(!JSON.stringify(usage).includes("PRIVATE"));
  assert.deepEqual(publicUsage(JSON.parse(JSON.stringify(usage)), "codebuddy-cn"), usage);
});

test("CodeBuddy edition follows CLI isPersonalEditionAccount and account selection", () => {
  assert.deepEqual(parseCodeBuddyAccounts({ accounts: [{ type: "personal", pluginEnabled: false, lastLogin: true }, { type: "ultimate", pluginEnabled: true, enterpriseName: "腾讯 Team" }] }),
    { edition: "enterprise", enterpriseName: "腾讯 Team" });
  assert.deepEqual(parseCodeBuddyAccounts({ accounts: [{ type: "personal", enterpriseId: "e1", pluginEnabled: true, enterpriseName: "<b>" }] }), { edition: "enterprise" });
  assert.deepEqual(parseCodeBuddyAccounts({ accounts: [{ type: "exclusive", pluginEnabled: true }, { type: "personal", pluginEnabled: true, lastLogin: true }] }), { edition: "personal" });
  assert.throws(() => parseCodeBuddyAccounts({ accounts: [{ type: "personal", pluginEnabled: false }] }));
  assert.throws(() => parseCodeBuddyAccounts({}));
});

test("CodeBuddy account failures are safe and only 401/403 mark authorization", async () => {
  for (const [status, state] of [[401, "unauthorized"], [403, "unauthorized"], [500, "unknown"]] as const) {
    const usage = await queryCodeBuddyUsage("codebuddy-cn", credential, signal(), async () => new Response('{"msg":"PRIVATE"}', { status }));
    assert.equal(usage.status, "unavailable"); assert.equal(usage.accountStatus?.state, state); assert.ok(!usage.message!.includes("PRIVATE"));
  }
  const business = await queryCodeBuddyUsage("codebuddy-cn", credential, signal(), async () => Response.json({ code: 11102, msg: "PRIVATE" }));
  assert.equal(business.accountStatus?.state, "unknown");
  let calls = 0;
  const bad = await queryCodeBuddyUsage("codebuddy-cn", { ...credential, access: "BAD\r\n" }, signal(), async () => { calls++; return envelope([]); });
  assert.equal(calls, 0); assert.equal(bad.status, "unavailable");
  const controller = new AbortController(); controller.abort();
  await assert.rejects(queryCodeBuddyUsage("codebuddy-cn", credential, controller.signal, async () => { calls++; return envelope([]); }), { name: "AbortError" });
  assert.equal(calls, 0);
  const empty = await queryCodeBuddyUsage("codebuddy-cn", credential, signal(), async () => envelope([]));
  assert.equal(empty.accountStatus?.state, "unknown"); assert.equal(empty.account, undefined);
});

test("CodeBuddy query never retries or refreshes and cancels late account responses", async () => {
  let calls = 0, canceled = 0, resolve!: (response: Response) => void;
  const controller = new AbortController();
  const pending = queryCodeBuddyUsage("codebuddy-cn", credential, controller.signal, () => { calls++; return new Promise<Response>(done => { resolve = done; }); });
  const rejected = assert.rejects(pending, { name: "AbortError" }); controller.abort(); await rejected;
  resolve(new Response(new ReadableStream({ cancel() { canceled++; } })));
  await new Promise(done => setImmediate(done));
  assert.equal(calls, 1); assert.equal(canceled, 1);
  const business = await queryCodeBuddyUsage("codebuddy-cn", credential, signal(), async () => { calls++; return Response.json({ code: 401, msg: "PRIVATE" }); });
  assert.equal(calls, 2); assert.equal(business.accountStatus?.state, "unauthorized"); assert.ok(!JSON.stringify(business).includes("PRIVATE"));
});
