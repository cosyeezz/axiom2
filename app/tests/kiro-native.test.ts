import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isBuiltin } from "node:module";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { createKiroNativeRequest, prepareKiroNativeRequest, sendKiroNativeRequest, kiroCliUserAgent, type KiroNativeContext } from "../src/server/providers/kiro-native.js";

const model = "deepseek-3.2";
const account = () => ({ access: "SYNTHETIC-ACCESS", expires: Date.now() + 60000, profileArn: "arn:aws:codewhisperer:eu-central-1:123456789012:profile/test" });
const context: KiroNativeContext = { systemPrompt: "Keep full policy", messages: [{ role: "user", content: "original text" }] };

test("native UA matches the captured macOS CLI version, not Node or Pi", () => {
  assert.equal(kiroCliUserAgent("darwin"), "KiroCLI/2.36.0 KAS/0.66.70 os/darwin md/appVersion-2.36.0 app/AmazonQ-For-CLI acp-client/kiro-cli");
});

test("native construction owns endpoint, auth, UA and protected headers", () => {
  const auth = account(), { payload } = createKiroNativeRequest(model, context, auth, "same-session");
  const prepared = prepareKiroNativeRequest(model, auth, payload, { "User-Agent": "Pi override", Authorization: "wrong", "proxy-authorization": "never-forward", "x-kiro-attempt": "99", "x-kiro-other": "wrong", "x-amzn-kiro-profile": "wrong", "x-fixture": "allowed" });
  assert.equal(prepared.url, "https://runtime.eu-central-1.kiro.dev/v1/responses");
  const headers = prepared.init.headers;
  assert.equal(headers.get("user-agent"), kiroCliUserAgent());
  assert.equal(headers.get("authorization"), "Bearer SYNTHETIC-ACCESS");
  assert.equal(headers.get("x-amzn-kiro-profile"), auth.profileArn);
  assert.equal(headers.get("x-kiro-attempt"), "1;max=1");
  assert.equal(headers.get("proxy-authorization"), null); assert.equal(headers.get("x-kiro-other"), null);
  assert.equal(headers.get("x-fixture"), "allowed");
  assert.equal(prepared.init.redirect, "error");
  assert.match(prepared.init.body, /Keep full policy/); assert.match(prepared.init.body, /original text/);
});

test("native guard rejects expired credentials, bad profile and replaced wire identity before transport", () => {
  const auth = account(), { payload } = createKiroNativeRequest(model, context, auth);
  for (const bad of [{ ...auth, expires: 0 }, { ...auth, access: "bad\r\nsecret" }, { ...auth, profileArn: "https://attacker.invalid" }, { ...auth, authMethod: "identity-center", profileArn: undefined }]) {
    assert.throws(() => prepareKiroNativeRequest(model, bad, payload));
  }
  for (const patch of [{ model: "other-model" }, { profileArn: "fake" }, { stream: false }, { origin: "other" }]) {
    assert.throws(() => prepareKiroNativeRequest(model, auth, { ...payload, ...patch }));
  }
});

test("native transport does not retry an error response", async () => {
  const auth = account(), { payload } = createKiroNativeRequest(model, context, auth);
  const prepared = prepareKiroNativeRequest(model, auth, payload);
  let calls = 0;
  const response = await sendKiroNativeRequest(prepared, AbortSignal.timeout(1000), async () => { calls++; return new Response(null, { status: 429 }); });
  assert.equal(calls, 1); assert.equal(response.status, 429);
});

test("native transport rejects pre-abort and cancels late bodies without a Pi lifecycle", async () => {
  const auth = account(), { payload } = createKiroNativeRequest(model, context, auth);
  const prepared = prepareKiroNativeRequest(model, auth, payload);
  let calls = 0, release!: (response: Response) => void, cancelled = false;
  const controller = new AbortController(); controller.abort();
  assert.throws(() => sendKiroNativeRequest(prepared, controller.signal, async () => { calls++; return new Response(); }));
  assert.equal(calls, 0);
  const later = new AbortController();
  const pending = sendKiroNativeRequest(prepared, later.signal, () => new Promise<Response>(resolve => { release = resolve; }));
  later.abort(); await assert.rejects(pending);
  release(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, true);
});

test("plain Node standalone bundle sends a real local HTTP tool loop without importing Pi", async () => {
  const bundled = await build({ entryPoints: [resolve("src/server/providers/kiro-native.ts")], bundle: true, platform: "node", format: "esm", external: ["kerberos"], banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' }, write: false, metafile: true });
  const external = Object.values(bundled.metafile!.outputs).flatMap(output => output.imports).filter(item => item.external);
  // Only builtins and optional, absent debug-color / disabled OS-negotiation dependencies; never Pi.
  assert.ok(external.every(item => isBuiltin(item.path) || ["kerberos", "supports-color"].includes(item.path)), JSON.stringify(external));
  assert.ok(Object.keys(bundled.metafile!.inputs).every(path => !/pi-(?:ai|agent|coding)/.test(path) && !path.includes("kiro-chat-protocol")));
  const dir = await mkdtemp(join(tmpdir(), "kiro-native-no-pi-"));
  try {
    const path = join(dir, "native.mjs"); await writeFile(path, bundled.outputFiles[0].text);
    const env: NodeJS.ProcessEnv = { ...process.env, NO_PROXY: "*", no_proxy: "*" }; delete env.NODE_OPTIONS; delete env.NODE_PATH;
    const { stdout } = await promisify(execFile)(process.execPath, [resolve("tests/fixtures/kiro-native-standalone.mjs"), path], { cwd: dir, env, timeout: 15000 });
    assert.deepEqual(JSON.parse(stdout), { requests: 2, toolRuns: 1, markerMatched: true, piLoaded: false });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
