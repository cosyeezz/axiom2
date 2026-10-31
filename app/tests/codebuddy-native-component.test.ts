import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCodeBuddyNativeProvider } from "../src/native-providers/index.js";
import { nativeProviderBundle } from "./fixtures/native-provider-bundle.js";

test("public CodeBuddy component performs synthetic auth, catalog and native tool roundtrip in plain Node without Pi", async () => {
  const bundle = await nativeProviderBundle(), dir = await mkdtemp(join(tmpdir(), "codebuddy-component-"));
  try {
    const path = join(dir, "component.mjs"); await writeFile(path, bundle);
    const env: NodeJS.ProcessEnv = { ...process.env, no_proxy: "*" }; delete env.NODE_OPTIONS; delete env.NODE_PATH;
    const { stdout } = await promisify(execFile)(process.execPath, [resolve("tests/fixtures/codebuddy-component.mjs"), path], { cwd: dir, env, timeout: 15000 });
    assert.deepEqual(JSON.parse(stdout), { login: true, refresh: true, logout: true, disposal: true, authRequests: 3, catalogRequests: 1, modelRequests: 3, toolRuns: 1, network: 0, piLoaded: false });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("component disposal cancels independent OAuth acquisition and closes its late response", async () => {
  let ready!: () => void, release!: (response: Response) => void, cancelled = false;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const provider = createCodeBuddyNativeProvider({ fetch: async () => { ready(); return new Promise(resolve => { release = resolve; }); } });
  const login = provider.auth.login({ signal: AbortSignal.timeout(3000), prompt: async () => "", notify() {} });
  const rejected = assert.rejects(login); await started; provider.dispose(); await rejected;
  release(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(cancelled, true);
});
