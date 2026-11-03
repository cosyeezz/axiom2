// Fully local download fixtures: no real release assets, installer, or backend commands.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, readFile, writeFile, rm, symlink, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
const { createUpdater } = await import(new URL("../desktop/updater.mjs", import.meta.url).href);
const base = "https://github.com/cosyeezz/axiom2/releases/download/", version = "0.4.2";
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function fixture(t: TestContext, platform = "darwin", arch = "arm64", supervised = false) {
  const root = await mkdtemp(join(tmpdir(), "axiom-client-download-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const name = platform === "win32" ? "Axiom2.msi" : platform === "darwin" ? "Axiom2.dmg" : `Axiom2-Linux-${arch}.deb`;
  const bytes = Buffer.from("verified local client artifact; never executable");
  const asset = { name, size: bytes.length, digest: `sha256:${digest(bytes)}`, browser_download_url: `${base}v${version}/${name}` };
  const release = { tag_name: `v${version}`, draft: false, prerelease: false, assets: [asset, { ...asset, name: "axiom2.tgz", browser_download_url: `${base}v${version}/axiom2.tgz` }] };
  const urls: string[] = [], commands: string[] = [];
  let response = async () => new Response(new Uint8Array(bytes), { headers: { "content-length": String(bytes.length) } });
  const fetcher = async (url: string) => {
    urls.push(url);
    if (url.endsWith("/latest")) return new Response(JSON.stringify(release));
    if (url.includes("?per_page=")) return new Response("[]");
    assert.equal(url, asset.browser_download_url, "only the selected in-memory asset may be fetched");
    return response();
  };
  const command = async (file: string) => { commands.push(file); throw Error("Client download must never execute commands"); };
  const options = { root, platform, arch, fetcher, ...(supervised ? {} : { command }) };
  const updater = createUpdater(options);
  return { root, name, bytes, asset, release, urls, commands, updater, options, respond: (next: typeof response) => response = next };
}

for (const [platform, arch] of [["darwin", "arm64"], ["linux", "x64"], ["linux", "arm64"]]) test(`${platform}/${arch} downloads via existing client task without a backend`, async t => {
  const f = await fixture(t, platform, arch);
  const before = await f.updater.check();
  assert.equal(before.clientDownloadSupported, true); assert.equal(before.serviceVersion, null);
  const result = await f.updater.runJob("client", version);
  assert.equal(result.job.task.status, "succeeded"); assert.equal(result.job.phase, "ready");
  assert.equal(result.job.task.resource, "client"); assert.equal(result.job.task.action, "download");
  assert.deepEqual(result.job.task.steps, ["checking", "downloading", "verifying"]);
  assert.equal(result.clientInstaller, null); assert.equal(result.job.installer, undefined);
  assert.equal(result.clientDownload.name, f.name); assert.equal(result.clientDownload.version, version);
  assert.deepEqual(await readFile(result.clientDownload.path), f.bytes); assert.deepEqual(f.commands, []);
  await f.updater.piRefresh();
  const restarted = createUpdater(f.options);
  assert.deepEqual((await restarted.status()).clientDownload, result.clientDownload);
  await assert.rejects(restarted.installer(), /安装包已变化/);
  const db = new DatabaseSync(join(f.root, "updates/jobs.sqlite"));
  try { assert.equal(db.prepare("SELECT count(*) AS n FROM client_installer").get()!.n, 0); } finally { db.close(); }
});

test("real local supervisor permits a pure download with damaged backend registration", async t => {
  const f = await fixture(t, "darwin", "arm64", true);
  await writeFile(join(f.root, "installation.json"), JSON.stringify({ node: "/no-such-node", cli: "/no-such-cli" }));
  await f.updater.check();
  const result = await f.updater.runJob("client", version);
  assert.equal(result.job.task.status, "succeeded"); assert.equal(result.clientDownload.name, f.name);
  assert.match(result.serviceError, /请先安装/);
  assert.deepEqual(f.urls.filter(url => !url.endsWith("/latest")), [f.asset.browser_download_url]);
});

for (const failure of ["403", "hash", "size", "oversize"]) test(`${failure} cannot publish a successful download`, async t => {
  const f = await fixture(t); await f.updater.check();
  f.respond(async () => failure === "403" ? new Response("forbidden", { status: 403 }) : new Response(new Uint8Array(failure === "hash" ? Buffer.alloc(f.bytes.length, 88) : failure === "size" ? f.bytes.subarray(1) : Buffer.concat([f.bytes, Buffer.from("extra")]))));
  const result = await f.updater.runJob("client", version);
  assert.equal(result.job.task.status, "failed"); assert.equal(result.clientDownload, null); assert.equal(result.clientInstaller, null);
  assert.deepEqual(f.commands, []);
});

test("failed newer download preserves old receipt, then retry uses a new task identity", async t => {
  const f = await fixture(t); await f.updater.check();
  const old = await f.updater.runJob("client", version);
  f.release.tag_name = "v0.4.3";
  for (const asset of f.release.assets) asset.browser_download_url = asset.browser_download_url.replace("v0.4.2/", "v0.4.3/");
  f.asset.digest = `sha256:${digest(Buffer.from("a new artifact"))}`; f.asset.size = 14;
  await f.updater.check();
  f.respond(async () => new Response("forbidden", { status: 403 }));
  const failed = await f.updater.runJob("client", "0.4.3");
  assert.equal(failed.job.task.status, "failed"); assert.deepEqual(failed.clientDownload, old.clientDownload);
  f.respond(async () => new Response("a new artifact"));
  const retried = await f.updater.runJob("client", "0.4.3");
  assert.equal(retried.job.task.status, "succeeded"); assert.notEqual(retried.job.task.id, failed.job.task.id);
  assert.equal(retried.clientDownload.version, "0.4.3");
  const history = await f.updater.history(); assert.ok(history.tasks.some((task: any) => task.id === failed.job.task.id && task.status === "failed"));
});

test("same-size tampering, symlinks and hard links invalidate a download receipt", async t => {
  const f = await fixture(t); await f.updater.check();
  const result = await f.updater.runJob("client", version), path = result.clientDownload.path;
  await writeFile(path, Buffer.alloc(f.bytes.length, 88)); assert.equal((await f.updater.status()).clientDownload, null);
  await rm(path); const external = join(f.root, "external"); await writeFile(external, f.bytes);
  await symlink(external, path); assert.equal((await f.updater.status()).clientDownload, null);
  await rm(path); await link(external, path); assert.equal((await f.updater.status()).clientDownload, null);
});

for (const kind of ["symlink", "hardlink"]) test(`invalid ${kind} cache replacement never overwrites an external file`, async t => {
  const f = await fixture(t); await f.updater.check();
  const external = join(f.root, "external"), path = join(f.root, "updates", `${digest(f.bytes)}-${f.name}`);
  await writeFile(external, "do not touch");
  await (kind === "symlink" ? symlink(external, path) : link(external, path));
  const result = await f.updater.runJob("client", version);
  assert.equal(result.job.task.status, "succeeded"); assert.equal(await readFile(external, "utf8"), "do not touch");
  assert.deepEqual(await readFile(result.clientDownload.path), f.bytes);
});

test("exact requested version and cached platform architecture are mandatory", async t => {
  const f = await fixture(t); await f.updater.check();
  const mismatch = await f.updater.runJob("client", "0.4.3"); assert.match(mismatch.job.message, /版本已变化/);
  const wrongPlatform = createUpdater({ ...f.options, platform: "linux" });
  assert.match((await wrongPlatform.runJob("client", version)).job.message, /请先检查本平台/);
  const wrongArch = createUpdater({ ...f.options, arch: "x64" });
  assert.match((await wrongArch.runJob("client", version)).job.message, /请先检查本平台/);
  assert.equal(f.urls.length, 1, "none of the rejected submissions fetch an asset");
});

test("missing platform assets and unsupported platforms never expose download success", async t => {
  const f = await fixture(t); f.release.assets = f.release.assets.filter(asset => asset.name !== f.name);
  await f.updater.check(); assert.equal((await f.updater.runJob("client", version)).clientDownload, null);
  const unsupported = createUpdater({ ...f.options, platform: "other" });
  assert.equal((await unsupported.check()).clientDownloadSupported, false);
  assert.equal((await unsupported.runJob("client", version)).job.task.status, "failed");
});

test("existing transfer progress and task-scoped cancellation leave no ready artifact", async t => {
  const f = await fixture(t); await f.updater.check();
  let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  f.respond(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(f.bytes.subarray(0, 8))); entered(); } }), { headers: { "content-length": String(f.bytes.length) } }));
  const pending = f.updater.runJob("client", version); await started; await delay(400);
  const downloading = await f.updater.status(); assert.equal(downloading.job.task.transfer.received, 8);
  assert.equal(downloading.job.task.transfer.total, f.bytes.length);
  await assert.rejects(f.updater.maintenanceControl("cancel", { id: "wrong-task" }));
  await f.updater.maintenanceControl("cancel", { id: downloading.job.task.id });
  const cancelled = await pending; assert.equal(cancelled.job.task.status, "cancelled"); assert.equal(cancelled.clientDownload, null);
  assert.equal(cancelled.job.task.capabilities.cancel, false);
});

test("a cancellation accepted before receipt commit wins even before the control tick", async t => {
  const f = await fixture(t); await f.updater.check();
  f.respond(async () => {
    const current = await f.updater.status();
    await f.updater.maintenanceControl("cancel", { id: current.job.task.id });
    return new Response(new Uint8Array(f.bytes));
  });
  const result = await f.updater.runJob("client", version);
  assert.equal(result.job.task.status, "cancelled"); assert.equal(result.clientDownload, null); assert.equal(result.clientInstaller, null);
});
