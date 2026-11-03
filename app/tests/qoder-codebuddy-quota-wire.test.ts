import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import type { OAuthCredential } from "@earendil-works/pi-ai";
import { queryQoderUsage } from "../src/server/providers/qoder-quota.js";
import { queryCodeBuddyUsage } from "../src/server/providers/codebuddy-usage.js";
import { codeBuddyHeaders } from "../src/native-providers/codebuddy/identity.js";

// Real native fetch to loopback with synthetic credentials only. The adapter still constructs
// fixed vendor URLs; this test's transport changes only their origin, not method/headers/body.
// This proves local HTTP header/body boundaries, not upstream TLS/CLI transport equivalence.
test("account read-only native HTTP: no host identity/body, redirects never forward credentials", async () => {
  const captures: { path: string; method: string; names: string[]; ua: string; bodyBytes: number; hostIdentity: boolean; requestId?: string }[] = [];
  let redirect = false;
  const server = createServer(async (req, res) => {
    let bodyBytes = 0;
    for await (const chunk of req) bodyBytes += Buffer.byteLength(chunk);
    captures.push({ path: req.url!, method: req.method!, names: Object.keys(req.headers).sort(), ua: String(req.headers["user-agent"] ?? ""), bodyBytes,
      hostIdentity: Object.values(req.headers).some(value => /axiom|earendil|pi-ai|\/Volumes\/|\/Users\//i.test(String(value))),
      requestId: req.headers["x-request-id"] as string | undefined });
    if (redirect) { res.writeHead(302, { Location: "/never-follow" }); res.end(); return; }
    const body = req.url?.endsWith("/accounts") ? { code: 0, data: { accounts: [{ pluginEnabled: true, type: "personal" }] } }
      : req.url?.endsWith("/plan") ? { user_type: "pro", plan_tier_name: "Pro" }
        : { userId: "synthetic", userType: "pro", userQuota: { total: 100, used: 12.5 } };
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(body));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address === "object");
  const local = `http://127.0.0.1:${address.port}`;
  const transport: typeof fetch = (url, init) => {
    const target = new URL(String(url));
    assert.ok(["https://openapi.qoder.com.cn", "https://copilot.tencent.com"].includes(target.origin));
    assert.equal(target.search, ""); assert.equal(init?.redirect, "error");
    return fetch(local + target.pathname, init);
  };
  const credential: OAuthCredential = { type: "oauth", access: "SYNTHETIC-TOKEN", refresh: "DO-NOT-SEND", expires: Date.now() + 3600000,
    region: "cn", userId: "DO-NOT-SEND", machineId: "DO-NOT-SEND", headers: { "User-Agent": "Axiom Pi", "X-Axiom-Session": "DO-NOT-SEND" } };
  try {
    const qoder = await queryQoderUsage("qoder-cn", credential, AbortSignal.timeout(5000), transport);
    const buddy = await queryCodeBuddyUsage("codebuddy-cn", credential, AbortSignal.timeout(5000), transport);
    assert.equal(qoder.status, "ready"); assert.equal(buddy.status, "ready"); assert.equal(captures.length, 3);
    const nativeDefaults = ["host", "connection", "accept", "accept-language", "sec-fetch-mode", "accept-encoding", "user-agent"];
    for (const capture of captures) {
      assert.equal(capture.method, "GET"); assert.equal(capture.bodyBytes, 0); assert.equal(capture.hostIdentity, false);
      const qoder = capture.path.startsWith("/api/");
      const provider = qoder ? ["authorization", "cosy-version", "cosy-clienttype", "cosy-machineos", "x-request-id"]
        : ["authorization", "content-type", "x-requested-with", "x-domain", "x-product"];
      assert.deepEqual(capture.names, [...nativeDefaults, ...provider].sort());
      assert.equal(capture.ua, qoder ? "node" : codeBuddyHeaders["User-Agent"]);
      if (qoder) assert.match(capture.requestId!, /^[A-F\d-]{36}$/);
    }
    redirect = true;
    const failedQoder = await queryQoderUsage("qoder-cn", credential, AbortSignal.timeout(5000), transport);
    const failedBuddy = await queryCodeBuddyUsage("codebuddy-cn", credential, AbortSignal.timeout(5000), transport);
    assert.equal(failedQoder.accountStatus?.state, "unknown"); assert.equal(failedBuddy.accountStatus?.state, "unknown");
    assert.equal(captures.length, 6); assert.ok(captures.every(capture => capture.path !== "/never-follow"));
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
