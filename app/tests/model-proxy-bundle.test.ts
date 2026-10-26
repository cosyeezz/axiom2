import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { atomicProxyJson, proxyConfigPath, proxyDirectory, readProxyConfig, type ProxyConfig } from "../src/server/integrations/model-proxy-config.js";
import { type ProxyRelease } from "../src/server/integrations/model-proxy-install.js";
import { xrayImporterDirectory } from "../src/server/integrations/model-proxy-xray-installer.js";
import { ModelProxyService, type ModelProxyDependencies } from "../src/server/integrations/model-proxy.js";
import { MaintenanceService } from "../src/server/maintenance.js";

const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const command = (op: string, params: Record<string, unknown> = {}) => ({ op: `modelProxy.${op}`, requestId: randomUUID(), params });
async function until(predicate: () => boolean) {
  const end = Date.now() + 5000;
  while (!predicate()) { assert.ok(Date.now() < end, "operation must settle"); await turn(); }
}
function fixture(prepare: ModelProxyDependencies["prepareImporter"], version = "2.0.0") {
  const root = mkdtempSync(join(tmpdir(), "axiom-xray-bundle-")), calls: string[] = [];
  const old = { version: "1.0.0", directory: `xray-1.0.0-${randomUUID()}` };
  const profile = { id: randomUUID(), name: "retained", kernel: "xray" as const, node: "node", source: "private-config", enabled: false };
  const config: ProxyConfig = { revision: "initial", installations: { xray: old }, profiles: [profile], bindings: { provider: profile.id } };
  mkdirSync(join(proxyDirectory(root), "versions", old.directory), { recursive: true });
  atomicProxyJson(proxyConfigPath(root), config);
  const maintenance = new MaintenanceService(root);
  const service = new ModelProxyService(root, () => {}, {
    latestRelease: async kernel => ({ kernel, version, asset: "fixture.zip", url: "https://github.com/fixture", sha256: "a".repeat(64) }),
    installKernel: async (_root, release: ProxyRelease, signal) => {
      signal.throwIfAborted(); calls.push(`core:${release.kernel}`);
      const directory = `${release.kernel}-${release.version}-${randomUUID()}`;
      mkdirSync(join(proxyDirectory(root), "versions", directory));
      writeFileSync(join(proxyDirectory(root), "versions", directory, "sentinel"), "prepared");
      return { version: release.version, directory };
    },
    prepareImporter: async (...args) => { calls.push("importer"); return await prepare!(...args); },
  });
  return { root, calls, old, config, service, maintenance, async close() { await service.close(); maintenance.close(); rmSync(root, { recursive: true, force: true }); } };
}
async function install(f: ReturnType<typeof fixture>, kernel = "xray") {
  await f.service.command(command("check", { kernel }));
  await until(() => !f.service.snapshot().job?.running);
  return await f.service.command(command("install", { kernel, version: f.service.snapshot().latest[kernel as "xray" | "mihomo"] }));
}

for (const sameVersion of [false, true]) test(`Xray ${sameVersion ? "same-version reinstall" : "update"} commits core only after importer succeeds`, async () => {
  let release!: () => void;
  const f = fixture(async (root, signal, progress) => {
    progress("preparing share import");
    await new Promise<void>(resolve => { release = resolve; }); signal.throwIfAborted();
    mkdirSync(xrayImporterDirectory(root), { recursive: true });
    return join(xrayImporterDirectory(root), "fixture");
  }, sameVersion ? "1.0.0" : "2.0.0");
  try {
    const accepted = await install(f); await until(() => !!release);
    assert.equal(accepted.job?.running, true);
    assert.deepEqual(readProxyConfig(f.root), f.config, "unverified bundle is not committed");
    for (const op of ["inspect", "uninstall"]) await assert.rejects(f.service.command(command(op, { kernel: "xray" })), { code: "BUSY" });
    release(); await until(() => !f.service.snapshot().job?.running);
    assert.equal(f.service.snapshot().job?.error, undefined);
    const config = readProxyConfig(f.root);
    assert.equal(config.installations.xray!.version, sameVersion ? "1.0.0" : "2.0.0");
    assert.notEqual(config.installations.xray!.directory, f.old.directory);
    assert.deepEqual(config.profiles, f.config.profiles); assert.deepEqual(config.bindings, f.config.bindings);
    assert.deepEqual(f.calls, ["core:xray", "importer"]);
    assert.ok(f.maintenance.snapshot().tasks.every(task => task.resource === "proxy:xray"));
    assert.equal(f.maintenance.snapshot().tasks.at(-1)!.status, "succeeded");
  } finally { release?.(); await f.close(); }
});

for (const mode of ["failure", "cancel", "close"] as const) test(`Xray importer ${mode} preserves previous installation and cleans candidate core`, async () => {
  let entered = false;
  const f = fixture(async (root, signal) => {
    mkdirSync(xrayImporterDirectory(root), { recursive: true }); entered = true;
    if (mode === "failure") throw Error("fixture importer failed");
    return await new Promise<never>((_, reject) => { signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
  });
  try {
    await install(f); await until(() => entered);
    if (mode === "cancel") await f.service.command(command("cancel", { jobId: f.service.snapshot().job!.id }));
    if (mode === "close") await f.service.close();
    await until(() => !f.service.snapshot().job?.running);
    const state = f.service.snapshot();
    assert.deepEqual(readProxyConfig(f.root), f.config);
    assert.deepEqual(readdirSync(join(proxyDirectory(f.root), "versions")), [f.old.directory]);
    assert.ok(existsSync(xrayImporterDirectory(f.root)), "cache remains discoverable for retry and combined cleanup");
    assert.ok(state.cleanup!.xray!.paths.includes(xrayImporterDirectory(f.root)));
    if (mode === "failure") assert.match(state.job!.error!, /importer failed/);
    else { assert.equal(state.job?.error, undefined); assert.equal(state.job?.message, "操作已取消。"); }
    assert.equal(f.maintenance.snapshot().tasks.at(-1)!.status, mode === "failure" ? "failed" : "cancelled");
  } finally { await f.close(); }
});

test("mihomo installation does not prepare the Xray importer", async () => {
  const f = fixture(async () => { throw Error("must not run"); });
  try {
    await install(f, "mihomo"); await until(() => !f.service.snapshot().job?.running);
    assert.equal(f.service.snapshot().job?.error, undefined);
    assert.deepEqual(f.calls, ["core:mihomo"]);
    assert.deepEqual(readProxyConfig(f.root).installations.xray, f.old);
  } finally { await f.close(); }
});

test("removed importer commands cannot mutate a legacy installation", async () => {
  const f = fixture(async () => "unused");
  try {
    for (const op of ["importerCheck", "importerInstall", "importerUninstall"]) await assert.rejects(f.service.command(command(op, { confirm: true, revision: "initial" })), { code: "UNKNOWN_OPERATION" });
    assert.deepEqual(readProxyConfig(f.root), f.config); assert.deepEqual(f.calls, []);
  } finally { await f.close(); }
});
