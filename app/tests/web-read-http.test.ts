import test from "node:test";
import assert from "node:assert/strict";
import { Resolver } from "node:dns/promises";
import net from "node:net";
import { Readable } from "node:stream";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { Agent, MockAgent, request } from "undici";
import { publicAddress, publicUrl, resolvePublic, pinnedAgent, downloadPublic } from "../src/server/web-access/safe-http.js";
import { webReadLimits as limits } from "../src/shared/web-read.js";

const signal = () => AbortSignal.timeout(5000);
test("public-address policy rejects local, special-use, mapped and transition destinations", () => {
  for (const ip of ["127.0.0.1", "0.0.0.0", "10.0.0.1", "172.16.0.1", "192.168.1.2", "169.254.169.254", "100.64.0.1", "198.18.0.1", "224.0.0.1", "::", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1", "2002:7f00:1::", "64:ff9b::7f00:1", "64:ff9b:1::7f00:1", "3fff::1"]) assert.equal(publicAddress(ip), false, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(publicAddress(ip), true, ip);
});
test("URL normalization rejects alternate private representations, credentials and unsafe routes", () => {
  for (const url of ["http://2130706433", "http://0x7f000001", "http://127.1", "http://[::ffff:127.0.0.1]", "file:///etc/passwd", "ftp://example.com", "https://user:password@example.com", "http://example.com:8080", "http://localhost.", "http://service.internal", "http://printer", " https://example.com", "https://example.com\n"]) assert.throws(() => publicUrl(url), { code: "URL_BLOCKED" }, url);
  assert.equal(publicUrl("https://example.com:443/a#fragment").href, "https://example.com/a");
});
test("DNS mixed public/private answers fail closed, public answers retain both families", async t => {
  t.mock.method(Resolver.prototype, "resolve4", async () => ["8.8.8.8"]);
  const six = t.mock.method(Resolver.prototype, "resolve6", async () => ["::1"]);
  await assert.rejects(resolvePublic("example.com", signal()), { code: "URL_BLOCKED" });
  six.mock.mockImplementation(async () => ["2606:4700:4700::1111"]);
  assert.deepEqual(await resolvePublic("example.com", signal()), [{ address: "8.8.8.8", family: 4 }, { address: "2606:4700:4700::1111", family: 6 }]);
  await assert.rejects(resolvePublic("example.com", AbortSignal.abort()), { code: "CANCELLED" });
});
test("pinned socket lookup never resolves hostname a second time", async t => {
  let observed = false;
  t.mock.method(net.Socket.prototype, "connect", function (this: net.Socket, ...args: any[]) {
    const options = Array.isArray(args[0]) ? args[0][0] : args[0];
    assert.equal(options.host, "example.com");
    options.lookup("example.com", { all: true }, (error: unknown, addresses: unknown) => {
      assert.equal(error, null); assert.deepEqual(addresses, [{ address: "8.8.8.8", family: 4 }]); observed = true;
    });
    queueMicrotask(() => this.destroy(Error("test socket: no network")));
    return this;
  });
  const agent = pinnedAgent([{ address: "8.8.8.8", family: 4 }]);
  try { await assert.rejects(request("http://example.com/path", { dispatcher: agent })); assert.equal(observed, true); }
  finally { await agent.destroy(); }
});
function transport(setup: (mock: MockAgent, hop: number) => void) {
  let hops = 0;
  return { resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    agent: () => { const mock = new MockAgent(); mock.disableNetConnect(); setup(mock, hops++); Object.defineProperty(mock, "destroy", { value: () => mock.close() }); return mock as unknown as Agent; }, request };
}
test("bounded manual redirects revalidate target before another request", async () => {
  let requests = 0;
  const mock = transport((agent) => {
    requests++;
    agent.get("https://example.com").intercept({ path: "/" }).reply(302, "", { headers: { location: "http://169.254.169.254/metadata" } });
  });
  await assert.rejects(downloadPublic("https://example.com", signal(), mock), { code: "URL_BLOCKED" }); assert.equal(requests, 1);
  const valid = transport((agent, hop) => agent.get("https://example.com").intercept({ path: hop ? "/final" : "/" }).reply(hop ? 200 : 302, hop ? "public text" : "", { headers: hop ? { "content-type": "text/plain" } : { location: "/final" } }));
  assert.equal((await downloadPublic("https://example.com", signal(), valid)).text, "public text");
  const loop = transport(agent => agent.get("https://example.com").intercept({ path: "/" }).reply(302, "", { headers: { location: "/" } }));
  await assert.rejects(downloadPublic("https://example.com", signal(), loop), { code: "REDIRECT_LIMIT" });
});
test("gzip and Brotli decode locally; wire and decoded limits apply", async () => {
  for (const [encoding, compress] of [["gzip", gzipSync], ["br", brotliCompressSync]] as const) {
    const mock = transport(agent => agent.get("https://example.com").intercept({ path: "/" }).reply(200, compress(Buffer.from("Hello webpage")), { headers: { "content-type": "text/plain; charset=utf-8", "content-encoding": encoding } }));
    assert.equal((await downloadPublic("https://example.com", signal(), mock)).text, "Hello webpage");
  }
  for (const compressed of [false, true]) {
    const body = Buffer.alloc(compressed ? limits.decodedBytes + 1 : limits.wireBytes + 1, "x");
    const mock = transport(agent => agent.get("https://example.com").intercept({ path: "/" }).reply(200, compressed ? gzipSync(body) : body, { headers: { "content-type": "text/plain", "content-encoding": compressed ? "gzip" : "identity" } }));
    await assert.rejects(downloadPublic("https://example.com", signal(), mock), { code: "BODY_LIMIT" });
  }
});
test("deadline and cancellation still destroy the body after headers arrive", async () => {
  for (const timeout of [false, true]) {
    let started = false;
    const body = new Readable({ read() { if (!started) { started = true; this.push("first bytes"); } } });
    const controller = new AbortController();
    const mock = { resolve: async () => [{ address: "8.8.8.8", family: 4 }], agent: pinnedAgent,
      request: (async () => ({ statusCode: 200, headers: { "content-type": "text/plain" }, body })) as unknown as typeof request };
    const pending = downloadPublic("https://example.com", timeout ? AbortSignal.timeout(15) : controller.signal, mock);
    const timer = setTimeout(() => { if (!timeout) controller.abort(); }, 20);
    try { await assert.rejects(pending); assert.equal(started, true); assert.equal(body.destroyed, true); }
    finally { clearTimeout(timer); }
  }
});
test("HTTP failures, binary files, unsupported encoding and delayed requests remain explicit", async () => {
  for (const [status, headers, code] of [[401, {}, "AUTH_REQUIRED"], [403, {}, "ACCESS_DENIED"], [429, {}, "RATE_LIMITED"], [200, { "content-type": "application/pdf" }, "UNSUPPORTED_CONTENT"], [200, { "content-type": "text/plain", "content-encoding": "unknown" }, "UNSUPPORTED_ENCODING"]] as const) {
    const mock = transport(agent => agent.get("https://example.com").intercept({ path: "/" }).reply(status, "body", { headers }));
    await assert.rejects(downloadPublic("https://example.com", signal(), mock), { code });
  }
  const slow = transport(agent => agent.get("https://example.com").intercept({ path: "/" }).reply(200, "slow", { headers: { "content-type": "text/plain" } }).delay(100));
  await assert.rejects(downloadPublic("https://example.com", AbortSignal.timeout(10), slow));
});
