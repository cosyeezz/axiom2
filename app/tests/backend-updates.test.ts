import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackendUpdates, runningBackendVersion } from "../src/server/backend-updates.js";
import { newerBackendVersion, stableVersion, validBackendUpdate } from "../src/shared/backend-updates.js";
import { relayBackendUpdates } from "../src/client/backend-update-bridge.js";

function release(version = "0.4.19") {
  return { tag_name: `v${version}`, draft: false, prerelease: false, assets: [{ name: "axiom2.tgz", browser_download_url: `https://github.com/cosyeezz/axiom2/releases/download/v${version}/axiom2.tgz`, size: 1234, digest: `sha256:${"a".repeat(64)}` }] };
}
function response(version = "0.4.19") { return Response.json(release(version), { headers: { etag: '"official-release"' } }); }
function setup(t: { after: (fn: () => void) => void }, options: ConstructorParameters<typeof BackendUpdates>[3] = {}, version: string | null = "0.4.10") {
  const db = new DatabaseSync(":memory:");
  const updates = new BackendUpdates(db, version, () => {}, { fetcher: async () => response(), ...options });
  t.after(() => { updates.close(); db.close(); }); return { db, updates };
}

test("backend update versions are stable, numeric and derived from our running package", async () => {
  for (const value of ["v0.4.19", "0.04.19", "0.4.19-beta", "0.4", "1.2.3.4", "1.2.1000000000", null]) assert.equal(stableVersion(value), false);
  assert.equal(stableVersion("0.4.19"), true);
  assert.equal(newerBackendVersion("0.4.19", "0.4.9"), true);
  assert.equal(newerBackendVersion("0.4.19", "0.4.20"), false);
  assert.equal(newerBackendVersion("0.4.19", "0.4.19"), false);
  assert.equal(await runningBackendVersion(), JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")).version);
});

test("fresh metadata advertises the actual running backend, not a desktop/global installation", async t => {
  const { updates } = setup(t);
  assert.equal(updates.snapshot().pending, false);
  const state = await updates.check();
  assert.equal(state.runningVersion, "0.4.10"); assert.equal(state.latest?.version, "0.4.19");
  assert.equal(state.available, true); assert.equal(state.pending, true); assert.equal(state.checking, false);
  assert.equal(validBackendUpdate(state), true);
  const { updates: current } = setup(t, {}, "0.4.19"); assert.equal((await current.check()).pending, false);
  const { updates: unknown } = setup(t, {}, null); assert.equal((await unknown.check()).available, false);
});

test("one atomic receipt per version survives dismiss, reconnect and backend process recreation", async t => {
  const root = await mkdtemp(join(tmpdir(), "axiom-notices-"));
  const owned: { db?: DatabaseSync; updates?: BackendUpdates } = {};
  t.after(async () => {
    try { owned.updates?.close(); }
    finally { try { owned.db?.close(); } finally { await rm(root, { recursive: true, force: true }); } }
  });
  let latest = "0.4.19", clock = 100;
  const options = { fetcher: async () => response(latest), now: () => clock };
  let db = owned.db = new DatabaseSync(join(root, "notices.sqlite"));
  let updates = owned.updates = new BackendUpdates(db, "0.4.10", () => {}, options);
  await updates.check();
  const claims = await Promise.all(Array.from({ length: 8 }, () => updates.command("present", latest)));
  assert.equal(claims.filter(state => state.notice === latest).length, 1);
  assert.equal(updates.snapshot().pending, false);
  await updates.command("dismiss", latest);
  assert.equal((await updates.command("present", latest)).notice, null);
  updates.close(); owned.updates = undefined;
  db.close(); owned.db = undefined;
  db = owned.db = new DatabaseSync(join(root, "notices.sqlite"));
  updates = owned.updates = new BackendUpdates(db, "0.4.10", () => {}, options);
  assert.equal(updates.snapshot().pending, false, "shown/dismissed receipt is not per-window memory");
  latest = "0.4.20"; clock++;
  assert.equal((await updates.check()).pending, true);
  assert.equal((await updates.command("present", latest)).notice, latest);
  assert.equal((await updates.command("present", "0.4.19")).notice, null);
});

test("dismissal is version-specific even before another window presents it", async t => {
  const { updates } = setup(t); await updates.check();
  await updates.command("dismiss", "0.4.19"); assert.equal(updates.snapshot().pending, false);
  await assert.rejects(updates.command("install", "0.4.19"), /参数无效/);
  await assert.rejects(updates.command("present", "../bad"), /参数无效/);
});

test("checks are single-flight, expose checking and refresh the cache with ETag/304", async t => {
  let resolve!: (response: Response) => void, calls = 0, headers: Headers | undefined, now = 100;
  const { updates } = setup(t, { now: () => now, fetcher: async (_url, init) => { calls++; headers = new Headers(init?.headers); return new Promise<Response>(done => { resolve = done; }); } });
  const first = updates.check(), second = updates.check(); assert.equal(first, second); assert.equal(calls, 1); assert.equal(updates.snapshot().checking, true);
  resolve(response()); await first; assert.equal(updates.snapshot().checking, false);
  now++;
  const third = updates.check(); assert.equal(headers!.get("If-None-Match"), '"official-release"');
  resolve(new Response(null, { status: 304 })); const state = await third;
  assert.equal(state.checkedAt, now); assert.equal(state.latest?.version, "0.4.19"); assert.equal(state.error, null);
});

test("failed or stale checks do not authorize new notifications or overwrite verified metadata", async t => {
  let now = 100, fail = false;
  const { updates } = setup(t, { intervalMs: 100, now: () => now, fetcher: async () => { if (fail) throw Error("offline fixture"); return response(); } });
  await updates.check(); now += 201; assert.equal(updates.snapshot().pending, false);
  fail = true; const state = await updates.check(); assert.match(state.error!, /offline/); assert.equal(state.pending, false); assert.equal(state.latest?.version, "0.4.19");
  assert.equal((await updates.command("present", "0.4.19")).notice, null);
});

test("rejects unofficial, malformed, prerelease, duplicate or digestless backend assets", async t => {
  const cases = [
    { ...release(), tag_name: "v0.4.19-beta" }, { ...release(), draft: true }, { ...release(), prerelease: true },
    { ...release(), assets: [] }, { ...release(), assets: [...release().assets, ...release().assets] },
    { ...release(), assets: [{ ...release().assets[0], browser_download_url: "https://evil.invalid/axiom2.tgz" }] },
    { ...release(), assets: [{ ...release().assets[0], digest: "" }] },
    { ...release(), assets: [{ ...release().assets[0], size: -1 }] },
  ];
  for (const value of cases) {
    const { updates } = setup(t, { fetcher: async () => Response.json(value) });
    const state = await updates.check(); assert.ok(state.error); assert.equal(state.available, false); assert.equal(state.pending, false);
  }
});

test("release regression, HTTP failure and oversized streaming metadata preserve safe state", async t => {
  let mode = "good", cancelled = false;
  const { updates } = setup(t, { fetcher: async () => mode === "good" ? response() : mode === "old" ? response("0.4.17") : mode === "http" ? new Response("rate limited", { status: 429 }) : new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2_000_001)); }, cancel() { cancelled = true; } })) });
  await updates.check();
  for (const next of ["old", "http", "large"]) { mode = next; const state = await updates.check(); assert.ok(state.error); assert.equal(state.latest?.version, "0.4.19"); assert.equal(state.pending, false); }
  assert.equal(cancelled, true, "bound the body during reading, not after buffering it all");
});

test("backend shutdown cancels an outstanding check without touching the closed database", async () => {
  const db = new DatabaseSync(":memory:"); let aborted = false, published = 0;
  const updates = new BackendUpdates(db, "0.4.10", () => { published++; }, { fetcher: async (_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => { aborted = true; reject(Error("aborted fixture")); }, { once: true })) });
  const checking = updates.check(); updates.close(); db.close();
  const state = await checking; assert.equal(aborted, true); assert.equal(state.pending, false); assert.equal(published, 1);
  await assert.rejects(updates.command("get"), /关闭/); await assert.rejects(updates.check(), /关闭/);
});

test("backend scheduler checks without a UI and stops permanently on close", async () => {
  const db = new DatabaseSync(":memory:"); let calls = 0;
  const updates = new BackendUpdates(db, "0.4.10", () => {}, { initialDelayMs: 1, intervalMs: 5, fetcher: async () => { calls++; return response(); } });
  try {
    updates.start(); updates.start();
    const deadline = Date.now() + 1000;
    while (calls < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 2));
    assert.ok(calls >= 2); updates.close(); const before = calls;
    await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(calls, before);
  } finally { updates.close(); db.close(); }
});

test("the native-to-WS relay is a fixed authenticated notification interface, never an installer", async t => {
  const { updates } = setup(t); const good = await updates.check();
  const reports: unknown[] = [], calls: string[] = [];
  const run = async (type: string) => { calls.push(type); return good; };
  const report = async (...args: unknown[]) => { reports.push(args); };
  await relayBackendUpdates({ probe: 1, action: "get" }, true, run, report);
  assert.deepEqual(calls, ["backendUpdates.get"]); assert.deepEqual((reports[0] as [number, { data: unknown }])[1].data, good);
  for (const detail of [{ probe: 2, action: "install" }, { probe: 3, action: "present", version: "../x" }, { probe: -1, action: "get" }]) await relayBackendUpdates(detail, true, run, report);
  assert.equal(calls.length, 1);
  await relayBackendUpdates({ probe: 4, action: "check" }, false, run, report); assert.equal(calls.length, 1);
  await relayBackendUpdates({ probe: 5, action: "get" }, true, async () => ({ ...good, latest: { version: "0.4.19", url: "https://evil.invalid/" } }), report);
  assert.equal((reports.at(-1) as [number, { data?: unknown }])[1].data, undefined); assert.match(String((reports.at(-1) as [number, { error: string }])[1].error), /响应|支持/);
});
