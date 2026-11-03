import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "./temporary.js";
import { SearchInstallationCache } from "../src/server/web-access/search-installation.js";
import { SearchCommandCache } from "../src/server/web-access/search-command-cache.js";
import { searchOpenCliInvocation } from "../src/server/web-access/opencli-command.js";
import { OpenCliSearchBackend } from "../src/server/web-access/search-query.js";
import { WebSearchService } from "../src/server/web-access/search-service.js";
import { openCliConfigPath, type OpenCliConfig } from "../src/server/integrations/opencli-runtime.js";
import { recordNodeRuntime, runtimeReceipt } from "../src/server/integrations/managed-node.js";
import { writeNodeLauncher } from "../src/server/integrations/node-launcher.js";
import { managedNodeFixture } from "./fixtures/managed-node.js";

const signal = () => new AbortController().signal;
function fixture(managed = false) {
  const root = mkdtempSync(join(tmpdir(), "axiom-search-cache-"));
  const directory = "v2.0.2-12345678-1234-1234-1234-123456789abc";
  const prefix = managed ? join(root, "integrations/opencli/versions", directory) : root;
  const packageRoot = join(prefix, "node_modules/@jackwener/opencli"), binDirectory = join(prefix, "node_modules/.bin");
  mkdirSync(packageRoot, { recursive: true }); mkdirSync(binDirectory, { recursive: true });
  const entry = join(packageRoot, "cli.cjs"), log = join(root, "calls.jsonl"), mode = join(root, "mode");
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "@jackwener/opencli", version: "2.0.2", bin: { opencli: "cli.cjs" } }));
  writeFileSync(entry, `const fs=require('node:fs'); const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');
const emit=data=>console.log(JSON.stringify({ok:true,data}));
if(args[0]==='profile'){const selectedFile=${JSON.stringify(join(root, "selected-profile"))};const selected=fs.existsSync(selectedFile)?fs.readFileSync(selectedFile,'utf8'):'context-a';emit({profiles:['context-a','context-b'].map(contextId=>({contextId,default:contextId===selected,connected:true}))});}
else { const op=args[3], id=args[args.indexOf('--session')+1], file=${JSON.stringify(root)}+'/'+id;
if(op==='open'){fs.writeFileSync(file,args[4]);emit({});}
if(op==='eval'){const url=fs.readFileSync(file,'utf8');const captcha=fs.existsSync(${JSON.stringify(mode)});emit({url,page:{kind:captcha?'captcha':'results',items:captcha?[]:[{title:'Example',url:'https://example.com/',snippet:'Summary'}]}});}
if(op==='close'){fs.rmSync(file,{force:true});emit({});}}
`);
  chmodSync(entry, 0o755);
  const shim = join(binDirectory, process.platform === "win32" ? "opencli.cmd" : "opencli");
  if (process.platform === "win32") { writeFileSync(shim, "fixture"); writeFileSync(join(binDirectory, "opencli.ps1"), "fixture"); }
  else symlinkSync(entry, shim);
  for (const name of ["opencli-usage", "opencli-browser"]) {
    const path = join(packageRoot, "skills", name, "SKILL.md"); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, "fixture");
  }
  const config: OpenCliConfig = { format: 1, revision: "revision", packageRoot, binDirectory, enabled: true, profile: "", window: "background", ...(managed ? { directory } : {}) };
  mkdirSync(dirname(openCliConfigPath(root)), { recursive: true });
  const save = () => writeFileSync(openCliConfigPath(root), JSON.stringify(config)); save();
  return { root, prefix, entry, packageRoot, shim, log, mode, config, save,
    calls: () => readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line) as string[]),
    close: () => rmSync(root, { recursive: true, force: true }) };
}

test("installation cache validates once, detects same-revision config edits and file identity changes", () => {
  const f = fixture(); let validations = 0;
  const cache = new SearchInstallationCache(f.root, root => { validations++; return searchOpenCliInvocation(root); });
  try {
    const first = cache.get(); assert.equal(cache.get(), first); assert.equal(validations, 1);
    writeFileSync(join(f.root, "unrelated"), "not an installation change");
    assert.equal(cache.get(), first); assert.equal(validations, 1);
    f.config.window = "foreground"; f.save(); assert.notEqual(cache.get().generation, first.generation); assert.equal(validations, 2);
    writeFileSync(f.entry, readFileSync(f.entry, "utf8") + "\n// updated entry\n"); cache.get(); assert.equal(validations, 3);
    const skill = join(f.packageRoot, "skills/opencli-browser/SKILL.md");
    writeFileSync(skill, "changed skill"); cache.get(); assert.equal(validations, 4);
    f.config.enabled = false; f.save(); assert.throws(() => cache.get(), { code: "OPENCLI_UNAVAILABLE" });
    f.config.enabled = true; f.save(); cache.get(); assert.equal(validations, 5);
    f.config.detached = true; f.config.packageRoot = ""; f.config.binDirectory = ""; f.save();
    assert.throws(() => cache.get(), { code: "OPENCLI_UNAVAILABLE" });
  } finally { f.close(); }
});

test("installation cache rejects removal, outside skill links, changed permissions and validation races", () => {
  for (const defect of ["remove", "skill-link", "mode", "race"]) {
    if (process.platform === "win32" && ["skill-link", "mode"].includes(defect)) continue;
    const f = fixture(); let racing = false;
    const cache = new SearchInstallationCache(f.root, root => {
      const value = searchOpenCliInvocation(root);
      if (racing) writeFileSync(f.entry, readFileSync(f.entry, "utf8") + "\n// race");
      return value;
    });
    try {
      cache.get();
      if (defect === "remove") rmSync(f.entry);
      if (defect === "mode") chmodSync(f.entry, 0o600);
      if (defect === "skill-link") {
        const skill = join(f.packageRoot, "skills/opencli-browser/SKILL.md"), outside = join(f.root, "outside.md");
        writeFileSync(outside, "outside"); rmSync(skill); symlinkSync(outside, skill);
      }
      if (defect === "race") { racing = true; cache.clear(); }
      assert.throws(() => cache.get(), { code: "OPENCLI_UNAVAILABLE" });
    } finally { f.close(); }
  }
});

test("managed runtime cache still detects nested npm writes, additions and ancestor substitution", async () => {
  for (const defect of ["nested-write", "addition", "ancestor"]) {
    if (process.platform === "win32" && defect === "ancestor") continue;
    const f = fixture(true);
    try {
      const runtime = await managedNodeFixture(() => "2.0.2").prepare("opencli", f.prefix, "@jackwener/opencli", "2.0.2", signal(), () => {});
      const nested = join(dirname(dirname(runtime.npm)), "lib", "dependency.cjs");
      mkdirSync(dirname(nested), { recursive: true }); writeFileSync(nested, "original");
      rmSync(runtimeReceipt(f.prefix)); recordNodeRuntime(f.prefix, runtime.binding);
      f.config.runtime = runtime.binding; f.save(); writeNodeLauncher(f.prefix, runtime.node, f.entry);
      let validations = 0;
      const cache = new SearchInstallationCache(f.root, root => { validations++; return searchOpenCliInvocation(root); });
      cache.get(); cache.get(); assert.equal(validations, 1);
      if (defect === "nested-write") writeFileSync(nested, "modified");
      if (defect === "addition") writeFileSync(join(dirname(nested), "added.cjs"), "added");
      if (defect === "ancestor") {
        const skillDir = join(f.packageRoot, "skills/opencli-browser"), outside = join(f.root, "outside");
        mkdirSync(outside); writeFileSync(join(outside, "SKILL.md"), "fixture"); rmSync(skillDir, { recursive: true }); symlinkSync(outside, skillDir);
      }
      assert.throws(() => cache.get(), { code: "OPENCLI_UNAVAILABLE" });
    } finally { f.close(); }
  }
});

function commandHarness() {
  let generation = 1, selected = "a", requested: string | undefined, fail = false, enabled = true;
  const calls: string[][] = [];
  const cache = new SearchCommandCache({ clear() { generation++; }, get() {
    if (!enabled) throw Error("disabled");
    return { generation, invocation: { node: "node", entry: "entry", env: { OPENCLI_PROFILE: requested } } };
  } }, async (_invocation, args) => {
    calls.push(args);
    if (args[0] === "profile") return { profiles: ["a", "b"].map(contextId => ({ contextId, connected: true, default: selected === contextId })) };
    if (fail) throw Error("offline"); return {};
  });
  return { cache, calls, select: (value: string) => { selected = value; }, request: (value: string) => { requested = value; generation++; },
    fail: (value: boolean) => { fail = value; }, enable: (value: boolean) => { enabled = value; }, change: () => { generation++; } };
}

test("profile is cached per run, fixed across default changes, refreshed on failure without switching identity", async () => {
  const h = commandHarness();
  const first = await h.cache.get("run-a", signal()); h.select("b");
  assert.equal(await h.cache.get("run-a", signal()), first);
  await first(["browser", "eval"], signal()); assert.deepEqual(h.calls.at(-1)?.slice(0, 2), ["--profile", "a"]);
  const second = await h.cache.get("run-b", signal()); await second(["browser", "eval"], signal());
  assert.deepEqual(h.calls.at(-1)?.slice(0, 2), ["--profile", "b"]);
  h.fail(true); await assert.rejects(first(["browser", "eval"], signal()), /offline/); h.fail(false);
  const recovered = await h.cache.get("run-a", signal()); await recovered(["browser", "eval"], signal());
  assert.deepEqual(h.calls.at(-1)?.slice(0, 2), ["--profile", "a"]);
  assert.equal(h.calls.filter(args => args[0] === "profile").length, 3);
  h.cache.releaseRun("run-a"); const fresh = await h.cache.get("run-a", signal()); await fresh(["browser", "eval"], signal());
  assert.deepEqual(h.calls.at(-1)?.slice(0, 2), ["--profile", "b"]); h.cache.close();
  await assert.rejects(h.cache.get("run-c", signal()), { code: "CANCELLED" });
});

test("released commands reject observations but still allow original-context cleanup", async () => {
  for (const outcome of ["release", "close"]) {
    const h = commandHarness(), command = await h.cache.get("run", signal());
    if (outcome === "release") h.cache.releaseRun("run"); else h.cache.close();
    const count = h.calls.length;
    await assert.rejects(command(["browser", "eval"], signal()), { code: "CANCELLED" });
    await assert.rejects(command(["browser", "open"], signal()), { code: "CANCELLED" });
    assert.equal(h.calls.length, count);
    await command(["browser", "close", "--session", "owned"], signal());
    assert.deepEqual(h.calls.at(-1)?.slice(0, 4), ["--profile", "a", "browser", "close"]); h.cache.close();
  }
});

test("pinned context cannot be replaced by another profile with the same alias", async () => {
  let generation = 1;
  const cache = new SearchCommandCache({ clear() {}, get: () => ({ generation, invocation: { node: "node", entry: "entry", env: {} } }) }, async () => ({
    profiles: generation === 1 ? [{ contextId: "original", default: true, connected: true }] : [
      { contextId: "original", connected: false }, { contextId: "different", alias: "original", default: true, connected: true },
    ],
  }));
  await cache.get("run", signal()); generation++;
  await assert.rejects(cache.get("run", signal()), { code: "PROFILE_UNAVAILABLE" }); cache.close();
});

test("config invalidation preserves the run identity and explicit profile changes need a new run", async () => {
  const h = commandHarness(); await h.cache.get("run", signal()); h.change(); h.select("b");
  const command = await h.cache.get("run", signal()); await command(["browser", "eval"], signal());
  assert.equal(h.calls.at(-1)?.[1], "a");
  h.enable(false); await assert.rejects(h.cache.get("run", signal()), /disabled/); h.enable(true);
  await h.cache.get("run", signal()); assert.equal(h.calls.filter(a => a[0] === "profile").length, 3);
  h.request("b"); await assert.rejects(h.cache.get("run", signal()), { code: "PROFILE_CHANGED" });
  h.cache.releaseRun("run"); await h.cache.get("run", signal()); h.cache.close();
});

test("ending a run or changing installation during profile discovery cannot publish a stale command", async () => {
  for (const outcome of ["release", "change", "abort"]) {
    let release!: () => void, generation = 1;
    const wait = new Promise<void>(resolve => { release = resolve; }), abort = new AbortController();
    const cache = new SearchCommandCache({ clear() {}, get: () => ({ generation, invocation: { node: "node", entry: "entry", env: {} } }) }, async () => {
      await wait; return { profiles: [{ contextId: "a", default: true, connected: true }] };
    });
    const pending = cache.get("run", abort.signal);
    if (outcome === "release") cache.releaseRun("run");
    if (outcome === "change") generation++;
    if (outcome === "abort") abort.abort();
    release(); await assert.rejects(pending, { code: outcome === "change" ? "OPENCLI_CHANGED" : "CANCELLED" }); cache.close();
  }
});

test("default backend saves profile-list subprocesses across a batch and subsequent calls, not across runs", async () => {
  // Explicit backend without window placement keeps CLI counts platform-independent.
  const f = fixture(), service = new WebSearchService(f.root, new OpenCliSearchBackend(f.root)), owner = { workspaceId: "w", sessionId: "s", runId: "r" };
  try {
    assert.equal((await service.search(owner, { queries: ["one", "two"] }, signal())).status, "success");
    assert.equal((await service.search(owner, { queries: ["three"] }, signal())).status, "success");
    assert.equal(f.calls().length, 10); assert.equal(f.calls().filter(a => a[0] === "profile").length, 1);
    service.releaseRun(owner);
    assert.equal((await service.search({ ...owner, runId: "next" }, { queries: ["four"] }, signal())).status, "success");
    assert.equal(f.calls().filter(a => a[0] === "profile").length, 2);
  } finally { service.close(); f.close(); }
});

test("run release stops active human-page observations without closing the handed-off tab", async () => {
  const f = fixture(), backend = new OpenCliSearchBackend(f.root);
  try {
    writeFileSync(f.mode, "captcha");
    await assert.rejects(backend.search("x", 0, 10, signal(), () => backend.releaseRun("run"), "run"), { code: "CANCELLED" });
    assert.equal(f.calls().filter(a => a[3] === "eval").length, 1);
    assert.equal(f.calls().filter(a => a[3] === "close").length, 0);
  } finally { backend.close(); f.close(); }
});

test("run release while eval is pending rejects the late result and still cleans its owned tab", async () => {
  let started!: () => void, finish!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const pendingEval = new Promise<void>(resolve => { finish = resolve; });
  const calls: string[] = [];
  const backend = new OpenCliSearchBackend("unused", () => async (args, activeSignal) => {
    calls.push(args[1]);
    if (args[1] === "eval") {
      started(); await pendingEval;
      return { url: "https://www.google.com/search?q=x", page: { kind: "results", items: [] } };
    }
    if (args[1] === "close") assert.equal(activeSignal.aborted, false);
    return {};
  });
  const search = backend.search("x", 0, 10, signal(), () => {}, "run");
  await ready; backend.releaseRun("run"); finish();
  await assert.rejects(search, { code: "CANCELLED" });
  assert.deepEqual(calls, ["open", "eval", "close"]); backend.close();
});

test("anonymous human-page resume pins its original profile but later independent queries do not share it", async () => {
  const f = fixture(), backend = new OpenCliSearchBackend(f.root), abort = new AbortController();
  try {
    writeFileSync(f.mode, "captcha");
    await assert.rejects(backend.search("x", 0, 10, abort.signal, () => abort.abort()), { code: "CANCELLED" });
    writeFileSync(join(f.root, "selected-profile"), "context-b"); rmSync(f.mode);
    await backend.search("x", 0, 10, signal(), () => {});
    assert.ok(f.calls().filter(a => a[0] === "--profile").every(a => a[1] === "context-a"));
    await backend.search("next", 0, 10, signal(), () => {});
    assert.equal(f.calls().at(-1)?.[1], "context-b");
    assert.equal(f.calls().filter(a => a[0] === "profile").length, 2);
  } finally { backend.close(); f.close(); }
});

test("disablement is checked on human-tab resume without navigating or closing the handed-off tab", async () => {
  const f = fixture(), backend = new OpenCliSearchBackend(f.root), abort = new AbortController();
  try {
    writeFileSync(f.mode, "captcha");
    await assert.rejects(backend.search("x", 0, 10, abort.signal, () => abort.abort(), "run"), { code: "CANCELLED" });
    const count = f.calls().length;
    f.config.enabled = false; f.save();
    await assert.rejects(backend.search("x", 0, 10, signal(), () => {}, "run"), { code: "OPENCLI_UNAVAILABLE" });
    assert.equal(f.calls().length, count);
    f.config.enabled = true; f.save(); rmSync(f.mode);
    assert.equal((await backend.search("x", 0, 10, signal(), () => {}, "run")).items.length, 1);
    assert.equal(f.calls().filter(a => a[3] === "open").length, 1);
  } finally { backend.close(); f.close(); }
});
