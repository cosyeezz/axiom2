import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { ReaService, type ReaDependencies } from "../src/server/integrations/rea.js";
import { listEngines } from "../src/server/integrations/rea-engines.js";
import { atomicReaJson, reaConfigPath, readReaConfig } from "../src/server/integrations/rea-runtime.js";
import { fixtureEngineRelease, reaFixture, writeReaPackage } from "./rea-fixture.js";

const temporary = () => mkdtempSync(join(tmpdir(), "axiom-rea-force-"));
const call = (service: ReaService, op: string, params = {}) => service.command({ op, params, requestId: randomUUID() });
async function settle(service: ReaService) {
  const deadline = Date.now() + 15_000;
  while (service.snapshot().jobs?.some(job => job.running)) { assert.ok(Date.now() < deadline, "fixture maintenance timed out"); await new Promise(resolve => setTimeout(resolve, 5)); }
  return service.snapshot();
}

test("REA resolves latest at install time; only query failure uses a known candidate", async () => {
  for (const mode of ["fresh", "fallback", "invalid", "unsupported"] as const) {
    const root = temporary(), fixture = reaFixture(); let preparations = 0, resolutions = 0;
    const prepare = fixture.dependencies.runtime!.prepare;
    fixture.dependencies.runtime!.prepare = async (...args) => { preparations++; return prepare(...args); };
    const service = new ReaService(root, () => {}, fixture.dependencies);
    try {
      await call(service, "rea.check"); assert.equal((await settle(service)).latest, "6.7.0");
      fixture.dependencies.runtime!.latest = async () => { resolutions++; if (mode === "fallback") throw Error("offline fixture"); return mode === "invalid" ? "not-a-version" : mode === "unsupported" ? "99.0.0" : "6.8.0"; };
      await call(service, "rea.install", { version: "6.7.0", revision: "old-client-snapshot" }); const state = await settle(service);
      assert.equal(resolutions, 1, "installation makes its own live query");
      if (mode === "invalid" || mode === "unsupported") {
        assert.match(state.job!.error!, mode === "invalid" ? /有效.*稳定版本/ : /契约尚未验证/);
        assert.equal(preparations, 0, "invalid/unsupported responses are not silently treated as network fallback");
        assert.equal(fixture.calls.filter(args => args[1] === "install").length, 0);
      } else {
        const expected = mode === "fresh" ? "6.8.0" : "6.7.0";
        assert.equal(state.job?.error, undefined); assert.equal(state.version, expected); assert.equal(preparations, 1);
        assert.ok(fixture.calls.some(args => args.at(-1) === `rea-agents@${expected}`));
        assert.equal(readReaConfig(root).installation?.version, expected);
      }
    } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
  }
});

test("REA cancellation during live resolution neither falls back nor cleans an existing installation", async () => {
  const root = temporary(), fixture = reaFixture(); let entered!: () => void;
  const resolving = new Promise<void>(resolve => { entered = resolve; });
  const service = new ReaService(root, () => {}, fixture.dependencies);
  try {
    await call(service, "rea.install"); assert.equal((await settle(service)).job?.error, undefined);
    const before = readReaConfig(root), calls = fixture.calls.length, path = service.snapshot().packageRoot!;
    fixture.dependencies.runtime!.latest = async (_name, signal) => { entered(); signal.throwIfAborted(); return new Promise<string>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })); };
    await call(service, "rea.install"); await resolving;
    await call(service, "rea.cancel", { jobId: service.snapshot().job!.id }); const state = await settle(service);
    assert.equal(state.job?.error, undefined); assert.match(state.job!.message, /已取消/);
    assert.deepEqual(readReaConfig(root), before); assert.equal(fixture.calls.length, calls); assert.ok(existsSync(path));
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("failed REA install force-cleans this component and retries only once", async () => {
  const root = temporary(), fixture = reaFixture(); const service = new ReaService(root, () => {}, fixture.dependencies);
  try {
    await call(service, "rea.install"); assert.equal((await settle(service)).job?.error, undefined);
    const oldPath = service.snapshot().packageRoot!, execute = fixture.dependencies.execute!;
    fixture.setLatest("6.8.0"); let installs = 0;
    fixture.dependencies.execute = async (args, options) => {
      if (args[1] === "install" && ++installs === 1) throw Error("fixture install failure");
      return execute(args, options);
    };
    await call(service, "rea.install"); const state = await settle(service);
    assert.equal(installs, 2); assert.equal(state.job?.error, undefined); assert.equal(state.version, "6.8.0");
    assert.equal(existsSync(oldPath), false, "force cleanup may remove the old installation; no rollback promise");
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("engine install resolves live, while explicit same-version reinstall always prepares a fresh tree", async () => {
  for (const mode of ["reuse", "reinstall", "new-release", "fallback"] as const) {
    const root = temporary(), directory = `v6.7.0-${randomUUID()}`, java = join(root, "external-jdk");
    writeReaPackage(join(root, "integrations", "rea", "versions", directory, "node_modules", "rea-agents"), "6.7.0");
    mkdirSync(java); writeFileSync(join(java, "release"), 'JAVA_RUNTIME_VERSION="21.0.13+8-LTS"\n');
    atomicReaJson(reaConfigPath(root), { format: 1, revision: randomUUID(), enabled: false, installation: { version: "6.7.0", directory }, engines: { java } });
    let resolutions = 0, preparations = 0; const preparedVersions: string[] = [];
    const dependencies: ReaDependencies = {
      engineRelease: async id => { resolutions++; if (resolutions > 1 && mode === "fallback") throw Error("offline fixture"); return { ...await fixtureEngineRelease(id), version: resolutions > 1 && mode === "new-release" ? "21.0.13+9" : "21.0.13+8" }; },
      checkEngines: async (_root, config) => listEngines(config).map(item => item.id === "java" ? { ...item, status: "ready", checkedAt: Date.now() } : item),
      prepareEngine: async (_root, id, _signal, _notify, _fetcher, release) => {
        assert.ok(release); preparations++; preparedVersions.push(release.version);
        const target = join(root, "integrations", "rea", "engines", `${id}-${randomUUID()}`);
        mkdirSync(target, { recursive: true }); writeFileSync(join(target, "release"), `JAVA_RUNTIME_VERSION="${release.version}-LTS"\n`);
        return { directory: target, path: target };
      },
    };
    const service = new ReaService(root, () => {}, dependencies);
    try {
      await call(service, "rea.engine-check", { engine: "java" }); assert.equal((await settle(service)).job?.error, undefined);
      await call(service, "rea.engine-install", { engine: "java", version: "21.0.13+8", reinstall: mode === "reinstall" || mode === "fallback" }); const state = await settle(service);
      assert.equal(state.job?.error, undefined); assert.equal(resolutions, 2, "old candidate does not avoid a live install-time resolution");
      assert.equal(preparations, mode === "reuse" ? 0 : 1);
      if (mode !== "reuse") assert.deepEqual(preparedVersions, [mode === "new-release" ? "21.0.13+9" : "21.0.13+8"]);
      assert.ok(existsSync(java), "external installation is not deleted");
    } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
  }
});
