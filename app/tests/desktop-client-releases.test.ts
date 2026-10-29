import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { createUpdater, clientAssetName } = await import(new URL("../desktop/updater.mjs", import.meta.url).href);
const base = "https://github.com/cosyeezz/axiom2/releases/download/";
const asset = (version: string, name: string) => ({ name, size: 123, digest: `sha256:${"a".repeat(64)}`, state: "uploaded", browser_download_url: `${base}v${version}/${name}` });
const release = (version: string, names: string[]) => ({ tag_name: `v${version}`, assets: names.map(name => asset(version, name)), draft: false, prerelease: false });
const api = "https://api.github.com/repos/cosyeezz/axiom2/releases/latest";
async function setup(t: any, platform: string, arch = "arm64", options: { latest?: any; history?: any; fail?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "axiom-client-release-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const calls: string[] = [];
  const latest = options.latest ?? release("0.4.21", ["axiom2.tgz"]);
  const history = options.history ?? [latest, release("0.4.19", ["Axiom2.msi", "Axiom2.dmg", "Axiom2-Linux-x64.deb", "Axiom2-Linux-arm64.deb"])];
  const updater = createUpdater({ root, platform, arch, fetcher: async (url: string) => {
    calls.push(url);
    if (url === api) return new Response(JSON.stringify(latest));
    assert.match(url, /^https:\/\/api.github.com\/repos\/cosyeezz\/axiom2\/releases\?per_page=30&page=[1-3]$/);
    return options.fail ? new Response("rate limited", { status: 403 }) : new Response(JSON.stringify(history));
  } });
  return { updater, root, calls };
}
for (const [platform, arch, name] of [["darwin", "arm64", "Axiom2.dmg"], ["darwin", "x64", "Axiom2.dmg"], ["win32", "x64", "Axiom2.msi"], ["linux", "x64", "Axiom2-Linux-x64.deb"], ["linux", "arm64", "Axiom2-Linux-arm64.deb"]]) {
  test(`backend-only latest independently finds ${platform}/${arch} installer`, async t => {
    const f = await setup(t, platform, arch), state = await f.updater.check();
    assert.equal(state.release.version, "0.4.21"); assert.equal(state.clientRelease.version, "0.4.19");
    assert.equal(state.clientAsset, name); assert.equal(state.clientPlatform, platform);
    assert.deepEqual(Object.keys(state.clientRelease.assets), [name]); assert.equal(state.clientReleaseError, null);
    assert.ok(state.clientCheckedAt); assert.equal(f.calls.length, 2);
    assert.equal((await f.updater.status()).clientRelease.version, "0.4.19");
  });
}
test("latest matching installer requires no history and unsupported Linux arch never gets x64", async t => {
  const f = await setup(t, "darwin", "arm64", { latest: release("0.4.22", ["axiom2.tgz", "Axiom2.dmg"]) });
  assert.equal((await f.updater.check()).clientRelease.version, "0.4.22"); assert.equal(f.calls.length, 1);
  const unsupported = await setup(t, "linux", "riscv64");
  assert.equal(clientAssetName("linux", "riscv64"), null);
  const state = await unsupported.updater.check(); assert.equal(state.clientRelease, null); assert.ok(state.clientCheckedAt); assert.equal(unsupported.calls.length, 1);
});
test("history ignores drafts, prereleases, unrelated platforms and malformed tags; selects numeric newest", async t => {
  const f = await setup(t, "darwin", "arm64", { history: [release("0.4.9", ["Axiom2.dmg"]), release("0.4.19", ["Axiom2.dmg"]), { ...release("0.5.0", ["Axiom2.dmg"]), draft: true }, { ...release("0.6.0", ["Axiom2.dmg"]), prerelease: true }, { ...release("0.7.0", ["Axiom2.dmg"]), tag_name: "android-v0.7.0" }, release("0.8.0", ["Axiom2.msi"])] });
  assert.equal((await f.updater.check()).clientRelease.version, "0.4.19");
});
for (const damage of ["url", "digest", "size", "duplicate"]) test(`client ${damage} validation fails closed without blocking backend`, async t => {
  const data = release("0.4.19", ["Axiom2.dmg"]);
  if (damage === "url") data.assets[0].browser_download_url = "https://example.com/Axiom2.dmg";
  if (damage === "digest") data.assets[0].digest = "sha256:not-a-hash";
  if (damage === "size") data.assets[0].size = 0;
  if (damage === "duplicate") data.assets.push(data.assets[0]);
  const f = await setup(t, "darwin", "arm64", { history: [data] }); const state = await f.updater.check();
  assert.equal(state.release.version, "0.4.21"); assert.equal(state.clientRelease, null);
  assert.match(state.clientReleaseError, /附件/); assert.equal(state.clientCheckedAt, null);
});
test("client history failure and corrupt cache do not block backend-only execution check", async t => {
  const f = await setup(t, "darwin", "arm64", { fail: true });
  const checked = await f.updater.check(); assert.equal(checked.release.version, "0.4.21"); assert.match(checked.clientReleaseError, /403/);
  f.calls.length = 0; assert.equal((await f.updater.check({ clients: false })).release.version, "0.4.21"); assert.equal(f.calls.length, 1);
  await writeFile(join(f.root, "updates/client-release.json"), "broken");
  const state = await f.updater.status(); assert.equal(state.release.version, "0.4.21"); assert.equal(state.clientRelease, null); assert.match(state.clientReleaseError, /缓存无效/);
});
test("invalid MSI on latest is a client error, not a backend update blocker", async t => {
  const latest = release("0.4.21", ["axiom2.tgz", "Axiom2.msi"]); latest.assets[1].digest = "missing";
  const f = await setup(t, "win32", "x64", { latest }); const state = await f.updater.check();
  assert.equal(state.release.version, "0.4.21"); assert.equal(state.clientRelease, null); assert.match(state.clientReleaseError, /附件/);
});
test("client discovery reports bounded history exhaustion instead of claiming current", async t => {
  const f = await setup(t, "darwin", "arm64", { history: Array.from({ length: 30 }, () => release("0.4.20", ["Axiom2.msi"])) });
  const state = await f.updater.check(); assert.equal(state.clientRelease, null); assert.match(state.clientReleaseError, /尚未找到/); assert.equal(f.calls.length, 4);
});
test("client-only latest discovers backend independently from older history", async t => {
  const latest = release("0.4.22", ["Axiom2.dmg"]);
  const f = await setup(t, "darwin", "arm64", { latest, history: [latest, release("0.4.21", ["axiom2.tgz"])] });
  const state = await f.updater.check(); assert.equal(state.release.version, "0.4.21"); assert.equal(state.clientRelease.version, "0.4.22"); assert.equal(state.releaseError, null);
});
test("failed backend discovery still publishes valid client; mandatory service check rejects", async t => {
  const latest = release("0.4.22", ["Axiom2.dmg"]);
  const f = await setup(t, "darwin", "arm64", { latest, fail: true });
  const state = await f.updater.check(); assert.equal(state.release, null); assert.match(state.releaseError, /403/); assert.equal(state.clientRelease.version, "0.4.22");
  await assert.rejects(f.updater.check({ clients: false }), /403/);
});
test("slow latest and client history share a total budget below the native helper limit", async t => {
  const root = await mkdtemp(join(tmpdir(), "axiom-update-budget-")); t.after(() => rm(root, { recursive: true, force: true }));
  // AbortSignal.timeout is unref'ed. Unlike real fetch, this fake request has
  // no socket to keep Node alive until the budget fires; keep it alive briefly.
  const keepAlive = setTimeout(() => {}, 2000); t.after(() => clearTimeout(keepAlive));
  const started = Date.now();
  const updater = createUpdater({ root, platform: "darwin", fetcher: async (url: string, init: RequestInit) => {
    if (url === api) { await new Promise(resolve => setTimeout(resolve, 50)); return new Response(JSON.stringify(release("0.4.21", ["axiom2.tgz"]))); }
    init.signal!.throwIfAborted();
    await new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
  } });
  const state = await updater.check({ timeoutMs: 100 });
  assert.equal(state.release.version, "0.4.21"); assert.equal(state.clientRelease, null); assert.ok(state.clientReleaseError); assert.ok(Date.now() - started < 2000, "client timeout returns the verified backend within the common budget");
});
