import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "./temporary.js";
import { discoverReaDependencies, reaDependencyEnvironment, reaLocalExecutablePath } from "../src/server/integrations/rea-auto-environment.js";
import { reaAutoBudget, reaBudgetEnvironment, reaDarwinReclaimableBytes, reaSettingCaps, reaTargetBytes } from "../src/server/integrations/rea-budget.js";
import { acquireReaBudget } from "../src/server/integrations/rea-budget-lock.js";
import { createReaToolPolicy, reaResultData, reaRetryLimit } from "../src/server/integrations/rea-tool-policy.js";

const temporary = () => mkdtempSync(join(tmpdir(), "axiom-rea-auto-"));
const host = { totalMiB: 16384, availableMiB: 12000, cpus: 12 };
const budget = reaAutoBudget(host);
const result = (data: unknown, isError = false) => {
  const text = JSON.stringify(isError ? { error: data } : data);
  return { content: [{ type: "text" as const, text }], structuredContent: { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) }, details: { original: true }, ...(isError ? { isError: true } : {}) };
};
const limitError = (setting = "regex.worker_heap_request_mib", value = 256) => result({ code: "resource_constraint", retryable: false, details: { operation: "search_strings", resource: "memory", limit: { setting, effective_value: value, minimum: 7, maximum: 16384, agent_editable: true, scope: "rea-runtime", rea_restart_required: false } } }, true);

test("REA budgets reserve resources, bound target sizes, JVM CPU and heap, and fail low safely", () => {
  assert.equal(reaDarwinReclaimableBytes("Mach Virtual Memory Statistics: (page size of 16384 bytes)\nFile-backed pages: 100.\nPages inactive: 999999.\n"), 1638400);
  for (const text of ["", "page size of 16384 bytes\nPages inactive: 100.", "page size of 1 bytes\nFile-backed pages: 100.", "page size of 16384 bytes\nFile-backed pages: 9999999999999999999999999."]) assert.equal(reaDarwinReclaimableBytes(text), 0);
  assert.equal(budget.memoryMiB, 7200); assert.equal(budget.heapMaximumMiB, 5040); assert.equal(budget.heapMiB, 1024); assert.equal(budget.cpus, 4);
  const large = reaAutoBudget(host, 101 * 1024 ** 2);
  assert.equal(large.heapMiB, 4096); assert.equal(large.operationTimeoutMs, 600000);
  assert.equal(reaAutoBudget({ totalMiB: 2048, availableMiB: 200, cpus: 1 }).heapMaximumMiB, 0);
  assert.equal(reaAutoBudget({ totalMiB: NaN, availableMiB: Infinity, cpus: NaN }).memoryMiB, 0);
  assert.equal(reaAutoBudget({ totalMiB: 1024, availableMiB: 1000, cpus: 64 }).memoryMiB, 488);
  assert.equal(reaBudgetEnvironment(large).REA_JADX_HEAP_MIB, "4096");
  assert.throws(() => reaBudgetEnvironment(reaAutoBudget({ totalMiB: 512, availableMiB: 200, cpus: 1 })), /内存不足/);
  assert.equal(reaLocalExecutablePath("C:\\Tools\\adb.exe", "win32"), true);
  for (const path of ["\\untrusted-bin", "\\\\server\\bin", "C:relative", "./bin", "C:\\bad\npath"]) assert.equal(reaLocalExecutablePath(path, "win32"), false);
  assert.ok(budget.requestTimeoutSeconds * 1000 > budget.operationMaximumMs);
  const root = temporary();
  try { writeFileSync(join(root, "target"), "small"); assert.equal(reaTargetBytes({ path: "target" }, root), 5); assert.equal(reaTargetBytes({ path: root }, root), 0); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test("POSIX dependency discovery uses executable absolute paths, preserves explicit choices and never mutates the source", { skip: process.platform === "win32" }, () => {
  const root = temporary(), bin = join(root, "bin"); mkdirSync(bin);
  try {
    for (const name of ["rizin", "adb", "apktool", "tshark", "capinfos", "mitmdump", "prlimit", "chromium"]) { writeFileSync(join(bin, name), "fixture"); chmodSync(join(bin, name), 0o700); }
    const source = { PATH: bin, REA_ADB_PATH: "/explicit/missing-adb" }, before = { ...source };
    const items = discoverReaDependencies(source, "linux", root), env = reaDependencyEnvironment(items);
    assert.deepEqual(source, before); assert.equal(env.REA_ADB_PATH, "/explicit/missing-adb");
    assert.equal(env.REA_RIZIN_COMMAND, join(bin, "rizin")); assert.equal(env.REA_BROWSER_EXECUTABLE, join(bin, "chromium"));
    assert.equal(env.REA_MITMDUMP_COMMAND, join(bin, "mitmdump")); assert.equal(env.REA_TSHARK_PRLIMIT_COMMAND, join(bin, "prlimit"));
    assert.equal(items.find(item => item.variable === "REA_ADB_PATH")?.source, "environment");
    assert.equal(discoverReaDependencies(source, "darwin", root).some(item => item.variable === "REA_MITMDUMP_COMMAND"), false);
    chmodSync(join(bin, "rizin"), 0o600);
    assert.notEqual(reaDependencyEnvironment(discoverReaDependencies({ PATH: bin }, "linux", root)).REA_RIZIN_COMMAND, join(bin, "rizin"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Windows discovery finds native exe and Chrome paths without overriding explicit choices", { skip: process.platform !== "win32" }, () => {
  const root = temporary(), bin = join(root, "bin"), programs = join(root, "Program Files"), chromeDir = join(programs, "Google", "Chrome", "Application");
  mkdirSync(bin); mkdirSync(chromeDir, { recursive: true });
  try {
    for (const name of ["rizin", "adb", "apktool", "tshark", "capinfos"]) writeFileSync(join(bin, `${name}.exe`), "fixture");
    const chrome = join(chromeDir, "chrome.exe"); writeFileSync(chrome, "fixture");
    const source = { Path: bin, PROGRAMFILES: programs, REA_ADB_PATH: "C:\\explicit\\missing-adb.exe" }, before = { ...source };
    const items = discoverReaDependencies(source, "win32", root), env = reaDependencyEnvironment(items);
    assert.deepEqual(source, before); assert.equal(env.REA_ADB_PATH, source.REA_ADB_PATH);
    assert.equal(items.find(item => item.variable === "REA_ADB_PATH")?.source, "environment");
    assert.equal(env.REA_RIZIN_COMMAND, realpathSync(join(bin, "rizin.exe")));
    assert.equal(env.REA_TSHARK_COMMAND, realpathSync(join(bin, "tshark.exe")));
    assert.equal(env.REA_BROWSER_EXECUTABLE, realpathSync(chrome));
    assert.equal(env.REA_MITMDUMP_COMMAND, undefined); assert.equal(env.REA_TSHARK_PRLIMIT_COMMAND, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("structured REA recovery requires a known editable safe resource error, never prose, timeout, cleanup or fixed outputs", () => {
  const caps = reaSettingCaps(budget);
  assert.deepEqual(reaRetryLimit("search_strings", limitError(), caps), { setting: "regex.worker_heap_request_mib", value: 512, parameter: undefined });
  assert.equal(reaResultData(result({ scope: "rea-runtime" }))?.scope, "rea-runtime");
  for (const operation of ["open_binary", "export_web_scripts", "observe_javascript_runtime", "start_gdb_session"]) assert.equal(reaRetryLimit(operation, limitError(), caps), undefined);
  for (const patch of [{ code: "provider_timeout" }, { code: "cleanup_incomplete" }, { retryable: undefined }, { details: { cleanup: "incomplete" } }, { details: { limit: { setting: "unknown" } } }]) {
    const data = { ...reaResultData(limitError()), ...patch };
    assert.equal(reaRetryLimit("search_strings", result(data, true), caps), undefined);
  }
  assert.equal(reaRetryLimit("search_strings", limitError("regex.worker_heap_request_mib", 512), caps), undefined);
  assert.equal(reaRetryLimit("analyze_javascript_application", limitError(), caps), undefined);
  const deadlineError = reaResultData(limitError())!;
  deadlineError.details.resource = "cpu";
  deadlineError.details.limit = { setting: "regex.matching_deadline_ms", effective_value: 5000, minimum: 1, maximum: 2147483647, scope: "rea-runtime", rea_restart_required: false, agent_editable: true };
  assert.equal(reaRetryLimit("search_strings", result(deadlineError, true), caps)?.value, 10000);
  for (const patch of [{ operation: "different" }, { resource: "memory" }, { cleanup: "unknown" }, { cleanup_report: {} }]) {
    assert.equal(reaRetryLimit("search_strings", result({ ...deadlineError, details: { ...deadlineError.details, ...patch } }, true), caps), undefined);
  }
});

function harness(root: string, execute: (args: any) => Promise<any>, hostBudget = budget, operation = "analyze_javascript_application", version = "6.8.0") {
  const policy = createReaToolPolicy(root, { budget: () => hostBudget, version });
  let closed = 0;
  // An impossible PID proves a gone POSIX group, not a reaped Windows tree.
  policy.attachTransport({ pid: 2147483646, close: async () => { closed++; } });
  const settings: any[] = [
    { setting: "javascript.analysis_timeout_ms", value: 300000, source: "default", minimum: 1, maximum: 2147483647, parameter: "analysis_timeout_ms" },
    { setting: "javascript.max_heap_mb", value: 1024, source: "default", minimum: 128, maximum: 16384, parameter: "max_heap_mb" },
    { setting: "jadx.operation_timeout_ms", value: 120000, source: "default", minimum: 1, maximum: 2147483647 },
    ...(operation.startsWith("search_") ? [{ setting: "regex.worker_heap_request_mib", value: 128, source: "default", minimum: 7, maximum: 16384 }] : []),
  ].map(setting => ({ ...setting, agent_editable: true }));
  const launch = Object.fromEntries(settings.map(setting => [setting.setting, setting.value]));
  let revision = 0;
  const changes: any[] = [], seen: any[] = [], tools = new Map<string, any>();
  const define = (operation: string, run: (args: any) => Promise<any>) => {
    const definition: any = { name: `mcp__rea__${operation}`, label: operation, description: operation,
      parameters: { type: "object", properties: { analysis_timeout_ms: { type: "integer" }, max_heap_mb: { type: "integer" } } }, annotations: { idempotentHint: true, destructiveHint: false, openWorldHint: false },
      execute: async (_id: string, args: any) => { seen.push({ operation, args: structuredClone(args) }); return run(args); } };
    const wrapped = policy.wrap(definition); tools.set(wrapped.name, wrapped); return wrapped;
  };
  define("inspect_analysis_settings", async () => result({ revision, settings: structuredClone(settings) }));
  define("update_analysis_settings", async args => {
    assert.equal(args.expected_revision === undefined || args.expected_revision === revision, true);
    for (const change of args.changes) {
      changes.push(structuredClone(change)); const setting = settings.find(item => item.setting === change.setting)!;
      setting.value = change.action === "reset" ? launch[change.setting] : change.value;
      setting.source = change.action === "reset" ? "default" : "runtime";
    }
    revision++; return result({ revision, settings: structuredClone(settings) });
  });
  const tool = define(operation, execute);
  const ctx: any = { cwd: root, executeTool: async (name: string, args: any, options: any) => {
    const output = await tools.get(name).execute("nested", args, options.signal, undefined, ctx);
    return { result: output, isError: output.isError ?? false };
  } };
  return { policy, tool, ctx, seen, changes, settings, closed: () => closed, run: (input = {}, signal?: AbortSignal) => tool.execute("test", operation.startsWith("search_") ? { mode: "regex", ...input } : input, signal, undefined, ctx) };
}

test("tool policy applies and restores shared defaults, preserves input and MCP result, caps explicit values", async () => {
  const root = temporary();
  try {
    const h = harness(root, async args => result({ heap: args.max_heap_mb, timeout: args.analysis_timeout_ms }));
    const input = { max_heap_mb: 99999, analysis_timeout_ms: 9999999 };
    const output = await h.run(input);
    assert.deepEqual(input, { max_heap_mb: 99999, analysis_timeout_ms: 9999999 });
    assert.deepEqual(reaResultData(output), { heap: 5040, timeout: 600000 });
    assert.equal(output.details.original, true); assert.equal(output.details.reaBudget.mode, "auto");
    assert.equal(h.settings[2].value, 120000); assert.deepEqual(h.changes.map(item => item.action), ["set", "reset"]);
    const external: any = { name: "mcp__other__probe" }; assert.equal(h.policy.wrap(external), external);
    assert.equal(h.closed(), 0);
    h.settings[1].source = "runtime"; h.settings[1].value = 512;
    assert.equal(reaResultData(await h.run())?.heap, 512, "smaller runtime preferences apply to automatic per-call defaults");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("audited regex failures change budgets exactly once; other modes and versions never replay", async () => {
  for (const [operation, version, mode, expected] of [
    ["search_strings", "6.8.0", "regex", 2],
    ["search_strings", "6.8.0", "literal", 1],
    ["search_strings", "6.9.0", "regex", 1],
    ["analyze_javascript_application", "6.8.0", "regex", 1],
    ["inspect_wasm_artifact", "6.8.0", "regex", 1],
  ] as const) {
    const root = temporary(); let calls = 0;
    try {
      const h = harness(root, async () => { calls++; return calls === 1 ? limitError() : result({ ok: true }); }, budget, operation, version);
      const output = await h.run({ mode });
      assert.equal(calls, expected, `${operation}/${version}/${mode}`);
      if (expected === 2) {
        assert.equal(reaResultData(output)?.ok, true);
        assert.ok(h.changes.some(change => change.setting === "regex.worker_heap_request_mib" && change.value === 512));
        assert.equal(h.settings.find(setting => setting.setting === "regex.worker_heap_request_mib")?.value, 128, "restored after upgrade");
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  const root = temporary(); let calls = 0;
  try {
    const h = harness(root, async () => { calls++; return limitError(); }, budget, "search_strings");
    await h.run(); assert.equal(calls, 2, "second resource failure never retries a third time");
    const preferred = harness(root, async () => { calls++; return limitError(undefined, 128); }, budget, "search_strings");
    const heap = preferred.settings.find(setting => setting.setting === "regex.worker_heap_request_mib")!;
    heap.source = "runtime";
    calls = 0; await preferred.run(); assert.equal(calls, 1, "explicit smaller runtime budgets are not raised");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("missing or unsafe server hints never authorize replay", async () => {
  for (const annotations of [{ idempotentHint: true }, { idempotentHint: true, destructiveHint: true, openWorldHint: false }, { idempotentHint: true, destructiveHint: false, openWorldHint: true }]) {
    const root = temporary(); let calls = 0;
    try {
      const h = harness(root, async () => { calls++; return limitError(); }, budget, "search_strings");
      Object.assign(h.tool.annotations, { idempotentHint: undefined, destructiveHint: undefined, openWorldHint: undefined }, annotations);
      await h.run(); assert.equal(calls, 1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("wrapped cleanup errors and refused restoration quarantine the runtime", async () => {
  const root = temporary();
  try {
    const cleanupRoot = join(root, "cleanup"), restoreRoot = join(root, "restore"), unknownRoot = join(root, "unknown");
    const cleanup = harness(cleanupRoot, async () => result({ code: "cleanup_incomplete", details: { cleanup: "incomplete" } }, true));
    await cleanup.run(); assert.equal(cleanup.closed(), 1, "real REA {error:...} envelope triggers teardown");
    const restore = harness(restoreRoot, async () => result({}));
    const execute = restore.ctx.executeTool;
    restore.ctx.executeTool = (name: string, args: any, options: any) => {
      if (args.changes?.some((change: any) => change.action === "reset")) return Promise.resolve({ isError: true, result: result({ code: "permission_denied" }, true) });
      return execute(name, args, options);
    };
    await assert.rejects(restore.run(), /未绕过工具权限/); assert.equal(restore.closed(), 1);
    const unknown = createReaToolPolicy(unknownRoot);
    unknown.attachTransport({ close: async () => {} });
    const tool = unknown.wrap({ name: "mcp__rea__binary_session", parameters: {}, execute: async () => result({}) } as any);
    await assert.rejects(tool.execute("unknown", {}, undefined, undefined, { cwd: root } as any), /未连接或已隔离/);
    assert.equal(existsSync(join(unknownRoot, "integrations/rea/budget/active.json")), false, "unknown PID is refused before admission");
    for (const ownedRoot of [cleanupRoot, restoreRoot]) {
      assert.equal(existsSync(join(ownedRoot, "integrations/rea/budget/active.json")), process.platform === "win32");
      if (process.platform === "win32") await assert.rejects(harness(ownedRoot, async () => result({})).run(), /尚未确认退出/);
    }
    await assert.rejects(cleanup.run(), /已隔离/); await assert.rejects(restore.run(), /已隔离/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("low memory refuses analysis; exceptions close owned runtime before releasing admission", async () => {
  const root = temporary(); let calls = 0;
  try {
    const lowRoot = join(root, "low"), failedRoot = join(root, "failed");
    const h = harness(lowRoot, async () => { calls++; return result({}); }, reaAutoBudget({ totalMiB: 512, availableMiB: 200, cpus: 1 }));
    await assert.rejects(h.run(), /内存不足/); assert.equal(calls, 0); assert.equal(h.closed(), 1);
    const failed = harness(failedRoot, async () => { throw Error("transport uncertain"); });
    await assert.rejects(failed.run(), /transport uncertain/); assert.equal(failed.closed(), 1);
    for (const ownedRoot of [lowRoot, failedRoot]) assert.equal(existsSync(join(ownedRoot, "integrations/rea/budget/active.json")), process.platform === "win32");
    await assert.rejects(failed.run(), /已隔离/);
    const fresh = harness(failedRoot, async () => result({ recovered: true }));
    if (process.platform === "win32") await assert.rejects(fresh.run(), /尚未确认退出/);
    else assert.equal(reaResultData(await fresh.run())?.recovered, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("connection replacement is refused pre-spawn and queued calls cannot reuse an isolated runtime", async () => {
  const root = temporary(); let calls = 0, start!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  try {
    const h = harness(root, async () => { calls++; start(); await gate; throw Error("transport closed"); });
    const first = assert.rejects(h.run(), /transport closed/);
    await started;
    const queued = assert.rejects(h.run(), /排队期间/);
    assert.throws(() => h.policy.attachTransport({ pid: 2147483645, close: async () => {} }), /连接已更换/);
    finish(); await first; await queued;
    assert.equal(calls, 1);
    await assert.rejects(h.run(), /已隔离/);
  } finally { finish(); rmSync(root, { recursive: true, force: true }); }
});

test("cross-worker resource lock queues, cancels, and never steals a live or uncertain owner", async () => {
  const root = temporary(), owner = { close: async () => {} };
  try {
    const release = await acquireReaBudget(root, owner, new AbortController().signal);
    const controller = new AbortController();
    const blocked = acquireReaBudget(root, owner, controller.signal);
    controller.abort(); await assert.rejects(blocked); release();
    const first = await acquireReaBudget(root, owner, new AbortController().signal); first(false);
    await assert.rejects(acquireReaBudget(root, owner, new AbortController().signal), /尚未确认退出/);
    writeFileSync(join(root, "integrations/rea/budget/active.json"), JSON.stringify({ worker: 2147483646 }));
    await assert.rejects(acquireReaBudget(root, owner, new AbortController().signal), /尚未确认退出/, "unknown server PID cannot be assumed dead even if its worker died");
    rmSync(join(root, "integrations/rea/budget/active.json"));
    const current = await acquireReaBudget(root, owner, new AbortController().signal);
    const script = join(root, "worker.mts"), acquired = join(root, "acquired");
    writeFileSync(script, `import {acquireReaBudget} from ${JSON.stringify(new URL("../src/server/integrations/rea-budget-lock.ts", import.meta.url).href)}; import {writeFileSync} from 'node:fs'; const release=await acquireReaBudget(process.argv[2],{close:async()=>{}},AbortSignal.timeout(10000)); writeFileSync(process.argv[3],'acquired'); release();`);
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), script, root, acquired], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = ""; child.stderr.on("data", chunk => stderr += chunk);
    const exited = once(child, "exit");
    await new Promise(resolve => setTimeout(resolve, 350)); assert.equal(existsSync(acquired), false);
    current();
    const [code] = await exited; assert.equal(code, 0, stderr); assert.equal(readFileSync(acquired, "utf8"), "acquired");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
