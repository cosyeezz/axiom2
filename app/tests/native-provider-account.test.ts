import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { nativeProviderBundle } from "./fixtures/native-provider-bundle.js";
import { createNativeAccount, type NativeCredentialSnapshot, type NativeCredentialStore, type NativeOAuth, type NativeOAuthCredential } from "../src/native-providers/index.js";

const credential = (expires = Date.now() + 60000): NativeOAuthCredential => ({ type: "oauth", access: "SYNTHETIC-ACCESS", refresh: "SYNTHETIC-REFRESH", expires });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
const signal = () => AbortSignal.timeout(5000);
const tick = () => new Promise<void>(yes => setImmediate(yes));
/** Test host, not a production persistence backend. */
function memoryStore(initial?: NativeOAuthCredential): NativeCredentialStore<NativeOAuthCredential> {
  let revision = 0, value = initial, queue = Promise.resolve();
  const snapshot = (): NativeCredentialSnapshot<NativeOAuthCredential> => structuredClone({ revision: String(revision), credential: value });
  return {
    async read(signal) { signal.throwIfAborted(); return snapshot(); },
    transaction(update, signal) {
      const work = queue.then(async () => {
        signal.throwIfAborted();
        const next = await update(snapshot());
        signal.throwIfAborted();
        if (next !== undefined) { value = next === null ? undefined : structuredClone(next); revision++; }
        return snapshot();
      });
      queue = work.then(() => {}, () => {});
      return work;
    },
  };
}
const interaction = () => ({ signal: signal(), prompt: async () => "unused", notify() {} });

test("standalone account uses the host lock for exactly one rotated refresh", async () => {
  const store = memoryStore(credential(0)); let refreshes = 0;
  const oauth: NativeOAuth<NativeOAuthCredential> = { login: async () => credential(), refresh: async () => {
    refreshes++; await tick(); return { ...credential(), refresh: "SYNTHETIC-ROTATED" };
  } };
  const account = createNativeAccount(oauth, store);
  const [first, second] = await Promise.all([account.resolve(signal()), account.resolve(signal())]);
  assert.equal(refreshes, 1); assert.equal(first.refresh, second.refresh);
  assert.equal((await store.read(signal())).revision, "1");
  account.dispose(); await assert.rejects(account.resolve(signal()), /关闭/);
});

test("failed refresh preserves storage; missing accounts never trigger automatic login", async () => {
  const previous = credential(0), store = memoryStore(previous); let logins = 0;
  const account = createNativeAccount({ login: async () => { logins++; return credential(); }, refresh: async () => { throw Error("fixed-test-error"); } }, store);
  await assert.rejects(account.resolve(signal()), /fixed-test-error/);
  assert.deepEqual((await store.read(signal())).credential, previous);
  await account.logout(signal());
  await assert.rejects(account.resolve(signal()), /尚未登录/); assert.equal(logins, 0);
  account.dispose();
});

test("logout aborts an uncooperative login promptly and its late credential cannot resurrect the account", async () => {
  const pending = deferred<NativeOAuthCredential>(), entered = deferred<void>(), store = memoryStore();
  const account = createNativeAccount({ login: async () => { entered.resolve(); return pending.promise; }, refresh: async () => credential() }, store);
  const login = account.login(interaction());
  const rejected = assert.rejects(login, { name: "AbortError" });
  await entered.promise; await account.logout(signal()); await rejected;
  pending.resolve(credential()); await tick();
  assert.deepEqual(await store.read(signal()), { revision: "1", credential: undefined });
  account.dispose();
});

test("revision checks reject late login after an external account change, including empty-account ABA", async () => {
  for (const next of [credential(), null]) {
    const pending = deferred<NativeOAuthCredential>(), entered = deferred<void>(), store = memoryStore();
    const account = createNativeAccount({ login: async () => { entered.resolve(); return pending.promise; }, refresh: async () => credential() }, store);
    const login = account.login(interaction());
    const rejected = assert.rejects(login, /账号存储已变化/);
    await entered.promise; await store.transaction(async () => next, signal());
    pending.resolve(credential()); await rejected;
    assert.deepEqual((await store.read(signal())).credential, next ?? undefined);
    assert.equal((await store.read(signal())).revision, "1"); account.dispose();
  }
});

test("cancelled refresh keeps the host lock until settlement and cannot publish late tokens", async () => {
  const pending = deferred<NativeOAuthCredential>(), entered = deferred<void>(), store = memoryStore(credential(0));
  let refreshes = 0;
  const account = createNativeAccount({ login: async () => credential(), refresh: async () => {
    if (++refreshes === 1) { entered.resolve(); return pending.promise; }
    return credential();
  } }, store);
  const controller = new AbortController();
  const first = account.resolve(controller.signal), rejected = assert.rejects(first, { name: "AbortError" });
  await entered.promise; controller.abort(); await rejected;
  const second = account.resolve(signal()); await tick(); assert.equal(refreshes, 1);
  pending.resolve({ ...credential(), access: "LATE-NOT-COMMITTED" });
  const current = await second; assert.equal(refreshes, 2); assert.notEqual(current.access, "LATE-NOT-COMMITTED");
  assert.equal((await store.read(signal())).revision, "1"); account.dispose();
});

test("public component bundles without Pi or host imports and performs synthetic OAuth in plain Node", async () => {
  const bundle = await nativeProviderBundle();
  const dir = await mkdtemp(join(tmpdir(), "kiro-component-account-"));
  try {
    const path = join(dir, "component.mjs"); await writeFile(path, bundle);
    const env = { ...process.env }; delete env.NODE_OPTIONS; delete env.NODE_PATH;
    const { stdout } = await promisify(execFile)(process.execPath, [resolve("tests/fixtures/native-provider-account.mjs"), path], { cwd: dir, env, timeout: 15000 });
    assert.deepEqual(JSON.parse(stdout), { login: true, refresh: true, prompts: ["method", "flow"], deviceNotices: 1, requests: 4, network: 0 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
