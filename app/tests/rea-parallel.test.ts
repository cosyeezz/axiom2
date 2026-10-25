import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ReaService } from "../src/server/integrations/rea.js";
import { listEngines } from "../src/server/integrations/rea-engines.js";
import { prepareEngineDownload } from "../src/server/integrations/rea-engine-download.js";
import { atomicReaJson, reaConfigPath, readReaConfig, type ReaConfig } from "../src/server/integrations/rea-runtime.js";
import { beginBuiltinOperation, builtinPendingOperation, reconcileBuiltinOperation, runBuiltinTool } from "../src/server/integrations/builtin-operation.js";
import { fixtureEngineRelease, writeReaPackage } from "./rea-fixture.js";
import { tmpdir } from "./temporary.js";
import type { ReaEngineId } from "../src/shared/rea-engines.js";

const temporary = () => realpathSync(mkdtempSync(join(tmpdir(), "axiom-rea-parallel-")));
const call = (service: ReaService, op: string, params = {}) => service.command({ requestId: randomUUID(), op, params });
async function until(check: () => boolean) {
  const deadline = Date.now() + 10_000;
  while (!check()) { assert.ok(Date.now() < deadline, "fixture did not reach expected state"); await delay(10); }
}
async function settle(service: ReaService, engine?: ReaEngineId) {
  await until(() => !(service.snapshot().jobs ?? []).some(job => job.running && (!engine || job.engine === engine)));
  return service.snapshot();
}
function config(root: string) {
  const directory = `v6.7.0-${randomUUID()}`;
  writeReaPackage(join(root, "integrations", "rea", "versions", directory, "node_modules", "rea-agents"), "6.7.0");
  const value: ReaConfig = { format: 1, revision: randomUUID(), enabled: false, skillInstalled: false, installation: { version: "6.7.0", directory } };
  atomicReaJson(reaConfigPath(root), value); return value;
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { release, wait: async (signal: AbortSignal) => {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      void promise.then(resolve).finally(() => signal.removeEventListener("abort", abort));
    });
    signal.throwIfAborted();
  } };
}
function selection(service: ReaService, engine: ReaEngineId) {
  const item = service.snapshot().engines!.find(item => item.id === engine)!;
  assert.ok(item.available);
  return { engine, revision: item.revision, token: item.available.token, version: item.available.version };
}

for (const outcome of ["success", "cancel", "failure"] as const) test(`independent component installs overlap, merge and isolate ${outcome}`, async () => {
  const root = temporary(), initial = config(root), java = gate(), jadx = gate(), entered = new Set<string>();
  const service = new ReaService(root, () => {}, {
    engineRelease: fixtureEngineRelease,
    checkEngines: async (_root, value) => listEngines(value).map(item => ({ ...item, status: item.path ? "ready" : item.status })),
    prepareEngine: async (_root, id, signal) => {
      entered.add(id); await (id === "java" ? java : jadx).wait(signal);
      if (id === "java" && outcome === "failure") throw Error("fixture component failed");
      const directory = join(root, "integrations", "rea", "engines", `${id}-${randomUUID()}`);
      mkdirSync(directory, { recursive: true }); return { directory, path: directory };
    },
  });
  try {
    await Promise.all([call(service, "rea.engine-check", { engine: "java" }), call(service, "rea.engine-check", { engine: "jadx" })]);
    await settle(service);
    const javaSelection = selection(service, "java"), jadxSelection = selection(service, "jadx");
    const wabtRevision = service.snapshot().engines!.find(item => item.id === "wabt")!.revision;
    await Promise.all([call(service, "rea.engine-install", javaSelection), call(service, "rea.engine-install", jadxSelection)]);
    await until(() => entered.size === 2);
    const active = service.snapshot().jobs!.filter(job => job.running);
    assert.equal(active.length, 2); assert.equal(new Set(active.map(job => job.id)).size, 2);
    await assert.rejects(call(service, "rea.engine-check", { engine: "java" }), { code: "BUSY" });
    await assert.rejects(call(service, "rea.install", { version: "6.7.0" }), { code: "BUSY" });
    await assert.rejects(call(service, "rea.uninstall", { revision: initial.revision, confirm: true }), { code: "BUSY" });
    await assert.rejects(call(service, "rea.save", { revision: initial.revision, enabled: true }), { code: "BUSY" });
    await assert.rejects(call(service, "rea.engine-uninstall", { engine: "java", revision: javaSelection.revision, confirm: true }), { code: "BUSY" });
    // The later task finishes first; the earlier task must not overwrite it.
    jadx.release(); await settle(service, "jadx");
    assert.ok(service.snapshot().jobs!.find(job => job.engine === "java")?.running);
    const installedJadx = readReaConfig(root).engines!.jadx;
    assert.ok(installedJadx);
    await call(service, "rea.engineSave", { engine: "wabt", revision: wabtRevision, path: join(root, "external-wabt") });
    assert.equal(service.snapshot().engines!.find(item => item.id === "java")?.available?.token, javaSelection.token);
    if (outcome === "cancel") await call(service, "rea.cancel", { jobId: active.find(job => job.engine === "java")!.id });
    else java.release();
    const state = await settle(service), saved = readReaConfig(root);
    assert.equal(saved.engines!.jadx, installedJadx); assert.equal(saved.engines!.wabt, join(root, "external-wabt"));
    assert.equal(!!saved.managedEngines?.java?.length, outcome === "success");
    assert.equal(saved.enabled, false); assert.equal(saved.skillInstalled, false); assert.deepEqual(saved.installation, initial.installation);
    assert.equal(state.jobs!.find(job => job.engine === "jadx")!.error, undefined);
    assert.equal(!!state.jobs!.find(job => job.engine === "java")!.error, outcome === "failure");
    assert.equal(state.pendingOperation, undefined); assert.ok(state.engines!.every(item => !item.pendingOperation));
    const tasks = JSON.parse(readFileSync(join(root, "maintenance", "tasks.json"), "utf8")).tasks;
    for (const job of active) assert.equal(tasks.find((task: { id: string }) => task.id === job.id).status, job.engine === "java" && outcome !== "success" ? outcome === "cancel" ? "cancelled" : "failed" : "succeeded");
    const restarted = new ReaService(root, () => {});
    assert.deepEqual(restarted.snapshot().jobs?.map(job => [job.engine, job.id]).sort(), state.jobs?.map(job => [job.engine, job.id]).sort());
    await restarted.close();
  } finally { java.release(); jadx.release(); await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("Java switches invalidate dependent checks and repeat in-flight installation validation", async () => {
  const root = temporary(), initial = config(root), validation = gate(), validatedJava: (string | undefined)[] = [];
  initial.engines = { java: join(root, "old-jdk"), jadx: join(root, "old-jadx.jar") };
  mkdirSync(initial.engines.java!); writeFileSync(initial.engines.jadx!, "existing fixture jar");
  atomicReaJson(reaConfigPath(root), initial);
  const service = new ReaService(root, () => {}, {
    engineRelease: fixtureEngineRelease,
    prepareEngine: async (_root, id) => {
      const directory = join(root, "integrations", "rea", "engines", `${id}-${randomUUID()}`);
      mkdirSync(directory, { recursive: true }); return { directory, path: directory };
    },
    checkEngines: async (_root, value, _package, signal, _run, only) => {
      if (only === "jadx" && value.managedEngines?.jadx?.length) {
        validatedJava.push(value.engines?.java);
        if (validatedJava.length === 1) await validation.wait(signal);
      }
      return listEngines(value).map(item => ({ ...item, status: item.path ? "ready" : item.status }));
    },
  });
  try {
    for (const engine of ["java", "jadx"] as const) await call(service, "rea.engine-check", { engine });
    await settle(service);
    const candidate = selection(service, "jadx");
    await call(service, "rea.engine-install", candidate);
    await until(() => validatedJava.length === 1);
    await call(service, "rea.engine-install", selection(service, "java")); await settle(service, "java");
    const state = service.snapshot(), item = state.engines!.find(item => item.id === "jadx")!;
    assert.equal(item.status, "unchecked", "a result checked using the old JDK must not remain ready");
    assert.equal(item.available?.token, candidate.token, "the confirmed JAR release is independent of the JDK path");
    validation.release(); await settle(service);
    assert.deepEqual(validatedJava, [initial.engines.java, readReaConfig(root).engines!.java]);
    assert.equal(service.snapshot().jobs!.find(job => job.engine === "jadx")!.error, undefined);
    assert.equal(service.snapshot().engines!.find(item => item.id === "jadx")!.status, "ready");
  } finally { validation.release(); await service.close(); rmSync(root, { recursive: true, force: true }); }
});

for (const cancel of [false, true]) test(`two manual downloads overlap and ${cancel ? "cancel independently" : "both persist"}`, { skip: process.platform !== "darwin" }, async () => {
  const root = temporary(); config(root);
  const ghidra = gate(), hopper = gate(), entered = new Set<string>();
  const service = new ReaService(root, () => {}, {
    engineRelease: fixtureEngineRelease,
    checkEngines: async (_root, value) => listEngines(value),
    prepareEngineDownload: async (root, id, release, signal, notify) => {
      const data = Buffer.from(`fixture ${id}`), digest = createHash(id === "hopper" ? "sha1" : "sha256").update(data).digest("hex");
      return prepareEngineDownload(root, id, { ...release, size: data.length, ...(id === "hopper" ? { sha1: digest } : { sha256: digest }) }, signal, notify, async () => {
        entered.add(id); await (id === "ghidra" ? ghidra : hopper).wait(signal); return new Response(data);
      });
    },
  });
  try {
    for (const engine of ["ghidra", "hopper"] as const) await call(service, "rea.engine-check", { engine });
    await settle(service);
    for (const engine of ["ghidra", "hopper"] as const) await call(service, "rea.engine-download", selection(service, engine));
    await until(() => entered.size === 2);
    const running = service.snapshot().jobs!.filter(job => job.running); assert.equal(running.length, 2);
    if (cancel) {
      await call(service, "rea.cancel", { jobId: running.find(job => job.engine === "ghidra")!.id });
      assert.equal(service.snapshot().jobs!.find(job => job.engine === "hopper")!.running, true);
      await assert.rejects(call(service, "rea.cancel", { jobId: running.find(job => job.engine === "ghidra")!.id }), { code: "NOT_RUNNING" });
    }
    hopper.release(); await settle(service, "hopper");
    assert.ok(readReaConfig(root).downloads?.hopper);
    ghidra.release(); await settle(service);
    const saved = readReaConfig(root);
    assert.equal(!!saved.downloads?.ghidra, !cancel); assert.equal(saved.engines, undefined);
    assert.deepEqual(readFileSync(join(root, "integrations", "rea", "downloads", saved.downloads!.hopper!.directory, "package.dmg")), Buffer.from("fixture hopper"));
  } finally { ghidra.release(); hopper.release(); await service.close(); rmSync(root, { recursive: true, force: true }); }
});

test("component requests automatically reconcile stopped jobs and legacy global barriers", async () => {
  const root = temporary(); config(root);
  const first = beginBuiltinOperation(root, "rea", undefined, "java"), second = beginBuiltinOperation(root, "rea", undefined, "jadx");
  first.close(); second.close(); // Simulate parent exit before its terminal record.
  for (const engine of ["java", "jadx"] as const) atomicReaJson(join(root, "integrations", "rea", "jobs", `${engine}.json`), { id: randomUUID(), kind: "engine-install", engine, running: true, message: "unfinished", startedAt: Date.now() });
  const service = new ReaService(root, () => {}, { engineRelease: fixtureEngineRelease, checkEngines: async (_root, value) => listEngines(value) });
  try {
    const state = service.snapshot(); assert.equal(state.jobs!.length, 2);
    assert.ok(state.jobs!.every(job => !job.running && /中断/.test(job.message)));
    await call(service, "rea.engine-check", { engine: "java" }); await settle(service);
    assert.equal(service.snapshot().engines!.find(item => item.id === "java")!.pendingOperation, undefined);
    await call(service, "rea.engine-check", { engine: "wabt" }); await settle(service);
    assert.ok(service.snapshot().engines!.find(item => item.id === "jadx")!.pendingOperation);
    await call(service, "rea.reconcile", { engine: "jadx", operationId: state.engines!.find(item => item.id === "jadx")!.pendingOperation });
    const legacy = beginBuiltinOperation(root, "rea"); legacy.close();
    await call(service, "rea.engine-check", { engine: "java" }); await settle(service);
    assert.equal(service.snapshot().pendingOperation, undefined);
    assert.equal(service.snapshot().jobs!.find(job => job.engine === "java")!.error, undefined);
  } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
});

for (const scope of ["java", undefined] as const) test(`separate processes honor ${scope ?? "legacy global"} admission and recovery`, { timeout: 20_000 }, async () => {
  const root = temporary(), driver = join(root, "holder.mjs");
  writeFileSync(driver, `import {beginBuiltinOperation} from ${JSON.stringify(new URL("../src/server/integrations/builtin-operation.ts", import.meta.url).href)};\nconst operation=beginBuiltinOperation(process.argv[2], 'rea', undefined, process.argv[3] || undefined);\nprocess.send('ready'); setInterval(()=>{}, 1000);\n`);
  const child = fork(driver, [root, scope ?? ""], { execArgv: ["--import", import.meta.resolve("tsx")], stdio: ["ignore", "ignore", "inherit", "ipc"] });
  const exited = once(child, "exit");
  try {
    assert.equal((await Promise.race([once(child, "message"), exited.then(() => { throw Error("holder exited early"); })]))[0], "ready");
    assert.throws(() => beginBuiltinOperation(root, "rea", undefined, "java"));
    assert.throws(() => beginBuiltinOperation(root, "rea"));
    assert.throws(() => beginBuiltinOperation(root, "rea", undefined, "jadx"), "a second backend cannot overwrite the running backend's shared maintenance history");
    const operationId = builtinPendingOperation(root, "rea", scope);
    assert.throws(() => reconcileBuiltinOperation(root, "rea", operationId, scope));
    child.kill("SIGKILL"); await exited;
    assert.throws(() => beginBuiltinOperation(root, "rea", undefined, "java"), "an available OS lock cannot bypass an unfinished parent commit");
    reconcileBuiltinOperation(root, "rea", operationId, scope);
    const fresh = beginBuiltinOperation(root, "rea"); fresh.finish(); fresh.close();
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    rmSync(root, { recursive: true, force: true });
  }
});

test("same-root component process owners and cancellation remain independent", { timeout: 20_000 }, async () => {
  const root = temporary(), a = beginBuiltinOperation(root, "rea", undefined, "java"), b = beginBuiltinOperation(root, "rea", undefined, "jadx");
  const left = new AbortController(), right = new AbortController(); let rightEnded = false;
  const script = "require('node:fs').writeFileSync(process.argv[1], 'ready'); setInterval(()=>{},1000)";
  const p = a.run(() => runBuiltinTool("rea", process.execPath, ["-e", script, join(root, "java-ready")], { cwd: root, signal: left.signal, timeout: 15_000 }));
  const q = b.run(() => runBuiltinTool("rea", process.execPath, ["-e", script, join(root, "jadx-ready")], { cwd: root, signal: right.signal, timeout: 15_000 }));
  void p.catch(() => {}); void q.then(() => { rightEnded = true; }, () => { rightEnded = true; });
  try {
    await until(() => existsSync(join(root, "java-ready")) && existsSync(join(root, "jadx-ready")));
    left.abort(); await assert.rejects(p); a.finish();
    assert.equal(rightEnded, false); assert.ok(builtinPendingOperation(root, "rea", "jadx"));
    const otherDirectory = join(root, "integrations", "rea", "engines", `jadx-${randomUUID()}`); mkdirSync(otherDirectory, { recursive: true });
    assert.throws(() => a.trackDirectory(otherDirectory), "one component cannot adopt another's directory");
    right.abort(); await assert.rejects(q); b.finish();
  } finally { left.abort(); right.abort(); await Promise.allSettled([p, q]); a.close(); b.close(); rmSync(root, { recursive: true, force: true }); }
});
