import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { ExecutionProfiles, type PreparedEnvironment } from "../src/server/execution-profile.js";
import type { ExecutionRejection } from "../src/server/execution-diagnostics.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-init-")), cwd = join(root, "project"), data = join(root, "data");
  const modelDir = join(root, "models"), nativeDir = join(root, "native-auth"), home = join(root, "home");
  for (const dir of [cwd, modelDir, home]) mkdirSync(dir);
  const keys = ["HOME", "USERPROFILE", "AXIOM_PI_DIR", "PI_CODING_AGENT_DIR"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { HOME: home, USERPROFILE: home, AXIOM_PI_DIR: modelDir, PI_CODING_AGENT_DIR: nativeDir });
  const raw = '{"providers":{}}';
  writeFileSync(join(modelDir, "models.json"), raw);
  const profiles = new ExecutionProfiles(data), environments: PreparedEnvironment[] = [];
  const input = { entry: "agent" as const, cwd, modelDir, modelsRaw: raw, mode: "D" as const };
  return { root, cwd, data, home, nativeDir, profiles, input,
    keep(environment: PreparedEnvironment) { environments.push(environment); return environment; },
    close() {
      for (const environment of environments) environment.release();
      for (const key of keys) { const value = previous[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

async function assertMissingDirectoryDrift(t: TestContext, environment: PreparedEnvironment, directory: string, scope: "project" | "ancestor") {
  const inspect = fs.lstatSync, rejections: Readonly<ExecutionRejection>[] = [];
  let changed = false, mutationError: unknown;
  const observing = t.mock.method(fs, "lstatSync", ((path: fs.PathLike, ...args: unknown[]) => {
    const value = (inspect as any)(path, ...args);
    if (!changed && String(path) === directory && value === undefined) {
      changed = true;
      queueMicrotask(() => { try { mkdirSync(directory); } catch (error) { mutationError = error; } });
    }
    return value;
  }) as typeof fs.lstatSync);
  syncBuiltinESMExports();
  try {
    // Empty groups have the same six absent resources across separate scans;
    // their missing-to-directory topology must still be stable within a scan.
    assert.equal(await environment.currentAsync!(undefined, rejection => { rejections.push(rejection); }), false);
    assert.ifError(mutationError); assert.equal(changed, true, "change a real directory after its missing witness is captured");
    assert.ok(rejections.some(rejection => rejection.check === "resource_scan" && rejection.stage === "resource_final" && rejection.scope === scope && rejection.cause === "metadata"));
  } finally { observing.mock.restore(); syncBuiltinESMExports(); }
  writeFileSync(join(directory, "AGENTS.md"), "new resource after the original binding");
  assert.equal(environment.current(), false, "cold execution still rejects an actual resource change between scans");
  assert.equal(await environment.currentAsync!(), false);
}

for (const asynchronous of [false, true]) {
  test(`agent SDK initialization precedes ${asynchronous ? "async" : "sync"} resource capture without writing settings or credentials`, async t => {
    const f = fixture(), create = SettingsManager.create.bind(SettingsManager);
    const initialize = t.mock.method(SettingsManager, "create", (...args: Parameters<typeof SettingsManager.create>) => create(...args));
    const instructions = join(f.cwd, "AGENTS.md"); writeFileSync(instructions, "fixture instructions");
    let reads = 0;
    const open = fs.promises.open;
    const observing = t.mock.method(fs.promises, "open", (async (...args: Parameters<typeof fs.promises.open>) => {
      if (String(args[0]) === instructions) {
        reads++;
        assert.equal(initialize.mock.calls.length, 1, "initialize once before the first asynchronous resource read");
        assert.ok(existsSync(join(f.cwd, ".pi")));
        assert.ok(existsSync(f.nativeDir));
      }
      return open(...args);
    }) as typeof fs.promises.open);
    syncBuiltinESMExports();
    try {
      const environment = f.keep(asynchronous ? await f.profiles.prepareAsync(f.input) : f.profiles.prepare(f.input));
      assert.equal(initialize.mock.calls.length, 1);
      assert.deepEqual(initialize.mock.calls[0].arguments, [f.cwd, join(f.data, "pi"), { projectTrusted: true }]);
      assert.ok(existsSync(join(f.cwd, ".pi")));
      assert.ok(existsSync(join(f.data, "pi")));
      assert.ok(existsSync(f.nativeDir));
      assert.equal(environment.reuse, "same-session"); assert.equal(environment.prewarmAllowed, true);
      if (asynchronous) assert.ok(reads > 0, "the asynchronous scan actually reads fixture resources");
      for (const file of [join(f.cwd, ".pi", "settings.json"), join(f.data, "pi", "settings.json"), join(f.nativeDir, "mcp-auth.json")])
        assert.equal(existsSync(file), false, `initialization does not create ${file}`);
      create(f.cwd, join(f.data, "pi"), { projectTrusted: true });
      assert.equal(environment.current(), true, "the worker's repeated SDK initialization cannot invalidate the captured identity");
      assert.equal(await environment.currentAsync!(), true);
      if (process.platform !== "win32") for (const dir of [f.nativeDir, join(f.cwd, ".pi"), join(f.data, "pi")])
        assert.equal(statSync(dir).mode & 0o777, 0o700);
    } finally { observing.mock.restore(); initialize.mock.restore(); syncBuiltinESMExports(); f.close(); }
  });
}

for (const style of ["default", "empty", "absolute", "relative", "tilde", "file-url", "same-as-models", "dot", "parent", "alias"] as const) {
  test(`native MCP directory keeps its original account namespace: ${style}`, () => {
    const f = fixture();
    let value: string | undefined, target: string;
    if (style === "default" || style === "empty") { value = style === "empty" ? "" : undefined; target = join(f.home, ".pi", "agent"); }
    else if (style === "relative") { value = "../.pi/账户"; target = resolve(f.cwd, value); }
    else if (style === "tilde") { value = "~/.native-账户"; target = join(f.home, ".native-账户"); }
    else if (style === "file-url") { target = join(f.root, "原生 OAuth"); value = pathToFileURL(target).href; }
    else if (style === "same-as-models") { value = target = f.input.modelDir; }
    else if (style === "dot") { value = "."; target = f.cwd; }
    else if (style === "parent") { value = ".."; target = f.root; }
    else if (style === "alias") {
      target = join(f.root, "native-link"); const actual = join(f.root, "native-actual"); mkdirSync(actual);
      symlinkSync(actual, target, process.platform === "win32" ? "junction" : "dir"); value = target;
    } else { value = target = join(f.root, "原生 OAuth"); }
    if (value === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = value;
    try {
      const environment = f.keep(f.profiles.prepare(f.input));
      assert.ok(existsSync(target), "resolve native relative paths using worker cwd, not the host cwd");
      assert.equal(process.env.PI_CODING_AGENT_DIR, value);
      assert.equal(environment.env.PI_CODING_AGENT_DIR, value, "do not relocate native OAuth or refresh locks to AXIOM_PI_DIR");
      assert.equal(environment.env.AXIOM_PI_DIR, f.input.modelDir);
      assert.equal(existsSync(join(target, "mcp-auth.json")), false, "never create or inspect credentials during preparation");
      assert.equal(existsSync(join(f.input.modelDir, "mcp-auth.json")), false);
    } finally { f.close(); }
  });
}

for (const entry of ["memory", "compression"] as const) for (const asynchronous of [false, true]) {
  test(`${entry} ${asynchronous ? "async" : "sync"} preparation never initializes agent settings or MCP storage`, async t => {
    const f = fixture();
    const initialize = t.mock.method(SettingsManager, "create", () => { throw Error("non-agent initialization"); });
    try {
      const input = { ...f.input, entry };
      f.keep(asynchronous ? await f.profiles.prepareAsync(input) : f.profiles.prepare(input));
      assert.equal(initialize.mock.calls.length, 0);
      for (const dir of [join(f.cwd, ".pi"), join(f.data, "pi"), f.nativeDir]) assert.equal(existsSync(dir), false);
    } finally { initialize.mock.restore(); f.close(); }
  });
}

test("already-cancelled preparation performs no agent initialization or snapshot write", async t => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  const initialize = t.mock.method(SettingsManager, "create", () => { throw Error("cancelled initialization"); });
  try {
    await assert.rejects(f.profiles.prepareAsync(f.input, controller.signal).then(environment => f.keep(environment)), { code: "AGENT_STOPPED" });
    assert.equal(initialize.mock.calls.length, 0); assert.equal(f.profiles.size, 0);
    for (const dir of [join(f.cwd, ".pi"), join(f.data, "pi"), f.nativeDir]) assert.equal(existsSync(dir), false);
  } finally { initialize.mock.restore(); f.close(); }
});

test("cancellation during real resource I/O cannot produce a fallback snapshot", async t => {
  const f = fixture(), controller = new AbortController(), instructions = join(f.cwd, "AGENTS.md");
  writeFileSync(instructions, "cancel while reading this fixture");
  const open = fs.promises.open;
  let cancelled = false;
  const observing = t.mock.method(fs.promises, "open", (async (...args: Parameters<typeof fs.promises.open>) => {
    const handle = await open(...args);
    if (String(args[0]) === instructions) { cancelled = true; controller.abort(); }
    return handle;
  }) as typeof fs.promises.open);
  syncBuiltinESMExports();
  try {
    await assert.rejects(f.profiles.prepareAsync(f.input, controller.signal).then(environment => f.keep(environment)), { code: "AGENT_STOPPED" });
    assert.equal(cancelled, true); assert.equal(f.profiles.size, 0);
    assert.deepEqual(fs.readdirSync(join(f.data, "execution-models")), []);
    assert.equal(existsSync(join(f.nativeDir, "mcp-auth.json")), false);
  } finally { observing.mock.restore(); syncBuiltinESMExports(); f.close(); }
});

for (const code of ["EACCES", "EROFS", "ENOTDIR"]) {
  test(`native OAuth directory ${code} retains cold execution and all resource drift checks`, async t => {
    const f = fixture(), mkdir = fs.mkdirSync;
    const blocked = t.mock.method(fs, "mkdirSync", ((path: fs.PathLike, ...args: unknown[]) => {
      if (String(path) === f.nativeDir) throw Object.assign(Error("fixture native directory failure"), { code });
      return (mkdir as any)(path, ...args);
    }) as typeof fs.mkdirSync);
    syncBuiltinESMExports();
    try {
      const environment = f.keep(await f.profiles.prepareAsync(f.input));
      assert.equal(environment.reuse, "single-use"); assert.equal(environment.prewarmAllowed, false);
      assert.equal(environment.current(), true, "optional native credentials are not required for a no-MCP cold execution");
      blocked.mock.restore(); syncBuiltinESMExports();
      await assertMissingDirectoryDrift(t, environment, join(f.root, ".pi"), "ancestor");
    } finally { blocked.mock.restore(); syncBuiltinESMExports(); f.close(); }
  });
}

test("missing read-only settings retain SDK defaults without bypassing a later real directory change", async t => {
  const f = fixture(), mkdir = fs.mkdirSync, projectPi = join(f.cwd, ".pi");
  const blocked = t.mock.method(fs, "mkdirSync", ((path: fs.PathLike, ...args: unknown[]) => {
    if (String(path) === projectPi) throw Object.assign(Error("fixture read-only project"), { code: "EACCES" });
    return (mkdir as any)(path, ...args);
  }) as typeof fs.mkdirSync);
  syncBuiltinESMExports();
  try {
    const environment = f.keep(await f.profiles.prepareAsync(f.input));
    assert.equal(existsSync(projectPi), false); assert.equal(environment.current(), true);
    assert.equal(environment.reuse, "single-use"); assert.equal(environment.prewarmAllowed, false);
    blocked.mock.restore(); syncBuiltinESMExports();
    await assertMissingDirectoryDrift(t, environment, projectPi, "project");
  } finally { blocked.mock.restore(); syncBuiltinESMExports(); f.close(); }
});

for (const failure of ["invalid-json", "unreadable"] as const) {
  test(`profile settings ${failure} still fail instead of accepting SDK defaults`, async t => {
    const f = fixture(), file = join(f.cwd, ".pi", "settings.json"); mkdirSync(join(f.cwd, ".pi"));
    writeFileSync(file, failure === "invalid-json" ? "{" : "{}");
    const read = fs.readFileSync;
    const blocked = t.mock.method(fs, "readFileSync", ((path: fs.PathOrFileDescriptor, ...args: unknown[]) => {
      if (failure === "unreadable" && String(path) === file) throw Object.assign(Error("fixture unreadable settings"), { code: "EACCES" });
      return (read as any)(path, ...args);
    }) as typeof fs.readFileSync);
    syncBuiltinESMExports();
    try {
      await assert.rejects(f.profiles.prepareAsync(f.input), failure === "invalid-json" ? SyntaxError : { code: "EACCES" });
      assert.equal(f.profiles.size, 0);
    } finally { blocked.mock.restore(); syncBuiltinESMExports(); f.close(); }
  });
}

test("existing private native credentials and refresh locks are neither opened nor migrated", async t => {
  const f = fixture(), credentials = join(f.nativeDir, "mcp-auth.json"), lock = credentials + ".lock";
  // SDK OAuth uses a distinct per-server proper-lockfile directory, not the storage lock above.
  const hash = createHash("sha256").update("mcp__fixture|http://127.0.0.1:1/mcp").digest("hex").slice(0, 16);
  const refreshLock = join(f.nativeDir, `mcp-auth-refresh-${hash}.lock`);
  mkdirSync(f.nativeDir, { mode: 0o755 }); mkdirSync(lock); mkdirSync(refreshLock, { mode: 0o700 });
  const bytes = '{"fixture":"not-a-real-account"}\n'; writeFileSync(credentials, bytes); writeFileSync(join(lock, "owner"), "fixture lock owner");
  const before = statSync(credentials), lockBefore = statSync(lock), refreshBefore = statSync(refreshLock), mode = statSync(f.nativeDir).mode;
  const names = fs.readdirSync(f.nativeDir).sort();
  let attempts = 0;
  const inspect = (path: unknown) => {
    if (String(path) === credentials || String(path).startsWith(lock) || String(path).startsWith(refreshLock)) { attempts++; throw Error("credential or refresh-lock access during preparation"); }
  };
  const read = fs.readFileSync, open = fs.openSync, openAsync = fs.promises.open;
  const readers = [
    t.mock.method(fs, "readFileSync", ((path: fs.PathOrFileDescriptor, ...args: unknown[]) => { inspect(path); return (read as any)(path, ...args); }) as typeof fs.readFileSync),
    t.mock.method(fs, "openSync", ((path: fs.PathLike, ...args: unknown[]) => { inspect(path); return (open as any)(path, ...args); }) as typeof fs.openSync),
    t.mock.method(fs.promises, "open", (async (...args: Parameters<typeof fs.promises.open>) => { inspect(args[0]); return openAsync(...args); }) as typeof fs.promises.open),
  ];
  syncBuiltinESMExports();
  try {
    const environment = f.keep(await f.profiles.prepareAsync(f.input));
    assert.equal(environment.current(), true); assert.equal(attempts, 0);
    for (const reader of readers) reader.mock.restore(); syncBuiltinESMExports();
    assert.equal(readFileSync(credentials, "utf8"), bytes); assert.equal(statSync(credentials).mtimeMs, before.mtimeMs);
    assert.equal(readFileSync(join(lock, "owner"), "utf8"), "fixture lock owner"); assert.equal(statSync(lock).mtimeMs, lockBefore.mtimeMs);
    assert.equal(statSync(refreshLock).mtimeMs, refreshBefore.mtimeMs); assert.equal(statSync(refreshLock).mode, refreshBefore.mode);
    assert.deepEqual(fs.readdirSync(refreshLock), []); assert.deepEqual(fs.readdirSync(f.nativeDir).sort(), names, "no new credential or refresh-lock namespace");
    assert.equal(statSync(f.nativeDir).mode, mode); assert.equal(existsSync(join(f.input.modelDir, "mcp-auth.json")), false);
  } finally { for (const reader of readers) reader.mock.restore(); syncBuiltinESMExports(); f.close(); }
});

test("preparing existing settings preserves bytes, timestamps and directory permissions", async () => {
  const f = fixture(), directory = join(f.cwd, ".pi"), file = join(directory, "settings.json"); mkdirSync(directory, { mode: 0o755 });
  const bytes = '{\n  "thinkingLevel": "high", "fixture": "preserve me"\n}\n'; writeFileSync(file, bytes);
  const before = statSync(file), mode = statSync(directory).mode;
  try {
    const environment = f.keep(await f.profiles.prepareAsync(f.input));
    assert.equal(readFileSync(file, "utf8"), bytes); assert.equal(statSync(file).mtimeMs, before.mtimeMs);
    assert.equal(statSync(directory).mode, mode, "do not chmod an existing user directory");
    assert.equal(environment.current(), true);
  } finally { f.close(); }
});
