import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { OpenCliSearchBackend } from "../src/server/web-access/search-query.js";
import { openCliCommand, searchOpenCliInvocation, selectSearchProfile, type OpenCliCommand } from "../src/server/web-access/opencli-command.js";
import { ownedSearchWindow, type SearchWindow } from "../src/server/web-access/search-window.js";

const signal = () => new AbortController().signal;
const page = (query: string, start = 0, kind = "results") => JSON.stringify({ url: `https://www.google.com/search?${new URLSearchParams({ q: query, start: String(start) })}`,
  page: { kind, items: kind === "results" ? [{ title: "example", url: "https://example.com/", snippet: "summary" }] : [], nextStart: start + 10 } });

test("query script really orchestrates OpenCLI arguments, pagination, isolated session and cleanup", async () => {
  const calls: string[][] = [], query = '-中文 "quoted"; $(no-shell)';
  const backend = new OpenCliSearchBackend("unused", () => async args => { calls.push(args); return args[1] === "eval" ? page(query, 10) : {}; });
  try {
    const result = await backend.search(query, 10, 5, signal(), () => {});
    assert.equal(result.items.length, 1); assert.equal(result.nextStart, 20);
    assert.deepEqual(calls.map(args => args.slice(0, 2)), [["browser", "open"], ["browser", "eval"], ["browser", "close"]]);
    const url = new URL(calls[0][2]); assert.equal(url.searchParams.get("q"), query); assert.equal(url.searchParams.get("start"), "10");
    assert.equal(url.searchParams.get("num"), "5");
    const sessions = calls.map(args => args[args.indexOf("--session") + 1]); assert.equal(new Set(sessions).size, 1); assert.match(sessions[0], /^axiom-search-/);
    assert.ok(calls.every(args => args.includes("background")));
    assert.doesNotMatch(calls[1][2], /fetch\(|XMLHttpRequest|document\.cookie/);
  } finally { backend.close(); }
});
test("profile selection pins actual context and refuses ambiguous or disconnected profiles", () => {
  const profiles = [{contextId:"context-a",alias:"work",connected:true,default:true},{contextId:"context-b",connected:true}];
  const pinned = selectSearchProfile({profiles}); assert.equal(pinned, "context-a");
  profiles[0].default = false; profiles[1].default = true;
  assert.equal(selectSearchProfile({profiles}, pinned), "context-a");
  assert.equal(selectSearchProfile({profiles}, "work"), "context-a");
  profiles[0].connected = false;
  assert.throws(() => selectSearchProfile({profiles}, pinned), {code:"PROFILE_UNAVAILABLE"});
  assert.equal(selectSearchProfile({profiles}), "context-b");
  assert.throws(() => selectSearchProfile({profiles:[]}), {code:"PROFILE_UNAVAILABLE"});
  assert.throws(() => selectSearchProfile({profiles:[{contextId:"a",connected:true},{contextId:"b",connected:true}]}), {code:"PROFILE_UNAVAILABLE"});
});
test("unknown navigation outcome remains blocked despite a successful cleanup acknowledgement", async () => {
  let opens = 0, closes = 0;
  const backend = new OpenCliSearchBackend("unused", () => async args => {
    if (args[1] === "open") { opens++; throw Error("client died after daemon dispatch"); }
    if (args[1] === "close") closes++;
    return {};
  });
  await assert.rejects(backend.search("x",0,10,signal(),()=>{}), {code:"OPENCLI_OUTCOME_UNKNOWN"});
  await assert.rejects(backend.search("x",0,10,signal(),()=>{}), {code:"CLEANUP_PENDING"});
  assert.equal(opens,1); assert.equal(closes,1); backend.close();
});
test("Google regional redirect is accepted only with the requested query and offset", async () => {
  const backend = new OpenCliSearchBackend("unused", () => async args => args[1] === "eval" ? page("x", 10).replace("www.google.com/", "www.google.com.hk/") : {});
  assert.equal((await backend.search("x", 10, 10, signal(), () => {})).items.length, 1); backend.close();
});
test("missing component fails closed with no global executable or proxy fallback", () => {
  assert.throws(() => searchOpenCliInvocation("/nonexistent-axiom-root"), { code: "OPENCLI_UNAVAILABLE" });
});
test("stale query, malformed extraction and explicit empty are distinguished and cleaned", async () => {
  for (const [data, code] of [[page("other"), "PAGE_CHANGED"], ["not JSON", "INVALID_RESPONSE"], [{ page: {} }, "INVALID_RESPONSE"]] as const) {
    let closed = false;
    const backend = new OpenCliSearchBackend("unused", () => async args => { if (args[1] === "close") closed = true; return data; });
    await assert.rejects(backend.search("expected", 0, 10, signal(), () => {}), { code }); assert.equal(closed, true); backend.close();
  }
  const backend = new OpenCliSearchBackend("unused", () => async args => args[1] === "eval" ? page("expected", 0, "empty") : {});
  assert.equal((await backend.search("expected", 0, 10, signal(), () => {})).items.length, 0); backend.close();
});
test("cancellation settles after separate cleanup and late results are not committed", async () => {
  const abort = new AbortController(), calls: string[][] = [];
  const backend = new OpenCliSearchBackend("unused", () => async (args, activeSignal) => {
    calls.push(args);
    if (args[1] === "open") abort.abort();
    if (args[1] === "close") assert.equal(activeSignal.aborted, false);
    return {};
  });
  await assert.rejects(backend.search("x", 0, 10, abort.signal, () => {}), { code: "CANCELLED" });
  assert.deepEqual(calls.map(args => args[1]), ["open", "close"]); backend.close();
});
test("cleanup failure blocks new navigation until acknowledgement", async () => {
  let fail = true; const calls: string[][] = [];
  const backend = new OpenCliSearchBackend("unused", () => async args => {
    calls.push(args); if (args[1] === "close" && fail) throw Error("offline");
    return args[1] === "eval" ? page("x") : {};
  });
  await assert.rejects(backend.search("x", 0, 10, signal(), () => {}), { code: "CLEANUP_PENDING" });
  await assert.rejects(backend.search("x", 0, 10, signal(), () => {}), { code: "CLEANUP_PENDING" });
  assert.equal(calls.filter(a => a[1] === "open").length, 1);
  fail = false; assert.equal((await backend.search("x", 0, 10, signal(), () => {})).items.length, 1); backend.close();
});
test("human handoff retains same tab on cancel and resumes without navigation", async () => {
  const abort = new AbortController(), calls: string[][] = []; let verified = false;
  const command: OpenCliCommand = async args => { calls.push(args); return args[1] === "eval" ? page("x", 0, verified ? "results" : "captcha") : {}; };
  const backend = new OpenCliSearchBackend("unused", () => command);
  await assert.rejects(backend.search("x", 0, 10, abort.signal, () => abort.abort()), { code: "CANCELLED" });
  assert.equal(calls.filter(a => a[1] === "close").length, 0);
  await assert.rejects(backend.search("different", 0, 10, signal(), () => {}), { code: "VERIFICATION_PENDING" });
  verified = true; assert.equal((await backend.search("x", 0, 10, signal(), () => {})).items.length, 1);
  assert.equal(calls.filter(a => a[1] === "open").length, 1);
  assert.ok(calls.find(a => a[1] === "eval" && a.includes("foreground"))); backend.close();
});
test("handed-off tabs cannot be resumed by another run and run-end releases only bookkeeping", async () => {
  const abort = new AbortController(), calls: string[][] = []; let verified = false;
  const backend = new OpenCliSearchBackend("unused", () => async args => { calls.push(args); return args[1] === "eval" ? page("x", 0, verified ? "results" : "captcha") : {}; });
  await assert.rejects(backend.search("x",0,10,abort.signal,()=>abort.abort(),"owner-a"), {code:"CANCELLED"});
  await assert.rejects(backend.search("x",0,10,signal(),()=>{},"owner-b"), {code:"VERIFICATION_PENDING"});
  const firstSession = calls[0][calls[0].indexOf("--session")+1];
  backend.releaseRun("owner-b");
  await assert.rejects(backend.search("x",0,10,signal(),()=>{},"owner-b"), {code:"VERIFICATION_PENDING"});
  backend.releaseRun("owner-a"); verified = true;
  assert.equal((await backend.search("x",0,10,signal(),()=>{},"owner-b")).items.length,1);
  const opens = calls.filter(args=>args[1]==="open"); assert.equal(opens.length,2);
  assert.notEqual(opens[1][opens[1].indexOf("--session")+1],firstSession);
  assert.equal(calls.filter(args=>args[1]==="close" && args.includes(firstSession)).length,0);
  backend.close();
});
test("close aborts active CLI work and prevents reuse", async () => {
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  const backend = new OpenCliSearchBackend("unused", () => async (args, activeSignal) => {
    if (args[1] === "open") { started(); await new Promise<void>(resolve => activeSignal.addEventListener("abort", () => resolve(), { once: true })); }
    return {};
  });
  const pending = backend.search("x", 0, 10, signal(), () => {}); await ready; backend.close();
  await assert.rejects(pending, { code: "CANCELLED" });
  await assert.rejects(backend.search("x", 0, 10, signal(), () => {}), { code: "CANCELLED" });
});
test("actual CLI subprocess JSON, argument safety, errors, output bound and timeout", async () => {
  const directory = mkdtempSync(join(tmpdir(), "axiom-search-cli-")), entry = join(directory, "fixture.mjs");
  writeFileSync(entry, `const [mode,...args]=process.argv.slice(2);
if(mode==='ok') console.log(JSON.stringify({ok:true,data:args}));
if(mode==='invalid') console.log('not JSON');
if(mode==='error'){console.error('secret stderr'); console.log(JSON.stringify({ok:false,error:{message:'secret stdout'}}));process.exitCode=1;}
if(mode==='overflow') console.log('x'.repeat(10000));
if(mode==='hang') setInterval(()=>{},1000);
`);
  const invocation = { node: process.execPath, entry, env: process.env };
  try {
    const args = ['-中文 "quote"; $(touch forbidden)', "a b"];
    assert.deepEqual(await openCliCommand(invocation, ["ok", ...args], signal()), args);
    for (const [mode, code] of [["invalid", "INVALID_RESPONSE"], ["error", "OPENCLI_FAILED"], ["overflow", "OUTPUT_LIMIT"], ["hang", "CANCELLED"]]) {
      await assert.rejects(openCliCommand(invocation, [mode], signal(), mode === "hang" ? 100 : 5000, mode === "overflow" ? 100 : 512000), (error: any) => {
        assert.equal(error.code, code); assert.doesNotMatch(error.message, /secret/); return true;
      });
    }
    const abort = new AbortController(); const pending = openCliCommand(invocation, ["hang"], abort.signal); abort.abort();
    await assert.rejects(pending, { code: "CANCELLED" });
    await assert.rejects(openCliCommand({ ...invocation, node: join(directory, "missing") }, [], signal()), { code: "OPENCLI_UNAVAILABLE" });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("search window is hidden after background navigation and shown only for verification", async () => {
  const events: string[] = []; let kind = "results"; let abort = new AbortController();
  const window: SearchWindow = { hide: async () => { events.push("hide"); }, show: async () => { events.push("show"); abort.abort(); } };
  const backend = new OpenCliSearchBackend("unused", () => async args => { events.push(args[1]); return args[1] === "eval" ? page(args[1] === "eval" ? query : "", 0, kind) : {}; }, window);
  let query = "x";
  try {
    await backend.search("x", 0, 10, signal(), () => {});
    assert.deepEqual(events, ["open", "hide", "eval", "close"]);
    events.length = 0; kind = "captcha"; query = "y";
    await assert.rejects(backend.search("y", 0, 10, abort.signal, () => {}), { code: "CANCELLED" });
    assert.deepEqual(events, ["open", "hide", "eval", "show"]);
    events.length = 0; kind = "results"; abort = new AbortController();
    window.show = async () => { events.push("show"); };
    assert.equal((await backend.search("y", 0, 10, signal(), () => {})).items.length, 1);
    assert.deepEqual(events, ["show", "eval", "hide", "close"]);
  } finally { backend.close(); }
});
test("window placement failure never changes the search result", async () => {
  const window: SearchWindow = { hide: async () => { throw Error("osascript denied"); }, show: async () => { throw Error("osascript denied"); } };
  const backend = new OpenCliSearchBackend("unused", () => async args => args[1] === "eval" ? page("x") : {}, window);
  assert.equal((await backend.search("x", 0, 10, signal(), () => {})).items.length, 1); backend.close();
});
test("owned search window is located only when it holds no user tabs", async () => {
  const run = (groups: unknown, tabs: unknown) => ownedSearchWindow(async args => {
    assert.deepEqual(args.slice(0, 3), ["browser", "chrome", "call"]);
    return args[3] === "tabGroups.query" ? groups : tabs;
  }, signal());
  assert.equal(await run([{ id: 7, windowId: 42 }], [{ groupId: 7, url: "https://www.google.com/search?q=x" }, { groupId: -1, url: "about:blank" }]), 42);
  assert.equal(await run([{ id: 7, windowId: 42 }], [{ groupId: 7 }, { groupId: -1, url: "https://mail.example/" }]), undefined);
  assert.equal(await run([], []), undefined);
  assert.equal(await run([{ id: 7, windowId: 42 }, { id: 8, windowId: 43 }], []), undefined);
  assert.equal(await run([{ id: 7, windowId: "42; do shell script" }], [{ groupId: 7 }]), undefined);
});
test("duplicate container groups are merged into the cleanest one instead of piling up", async () => {
  const setup = (groups: [number, number][], tabs: { id: number; groupId: number; windowId: number; url?: string }[]) => {
    const state = { groups: new Map(groups), tabs };
    const calls: string[][] = [];
    const command: OpenCliCommand = async args => {
      const method = args[3]!, argv = JSON.parse(args[4] ?? "[]") as any[];
      calls.push([method, JSON.stringify(argv[0])]);
      if (method === "tabGroups.query") return [...state.groups].map(([id, windowId]) => ({ id, windowId }));
      if (method === "tabs.query") return state.tabs.filter(tab => tab.windowId === (argv[0] as { windowId: number }).windowId);
      if (method === "tabs.move") {
        const [ids, target] = argv as [number[], { windowId: number }];
        for (const tab of state.tabs) if (ids.includes(tab.id)) tab.windowId = target.windowId;
        return {};
      }
      if (method === "tabs.group") {
        const { groupId, tabIds } = argv[0] as { groupId: number; tabIds: number[] };
        for (const tab of state.tabs) if (tabIds.includes(tab.id)) tab.groupId = groupId;
        for (const [id, windowId] of [...state.groups]) {
          if (!state.tabs.some(tab => tab.groupId === id && tab.windowId === windowId)) state.groups.delete(id);
        }
        return groupId;
      }
      throw Error(`unexpected ${method}`);
    };
    return { state, calls, run: () => ownedSearchWindow(command, signal()) };
  };
  const urls = ["https://www.google.com/search?q=x", "https://www.google.com/search?q=y"];
  const merged = setup([[7, 42], [8, 43]], [
    { id: 1, groupId: 7, windowId: 42, url: urls[0] },
    { id: 2, groupId: 8, windowId: 43, url: urls[1] }]);
  assert.equal(await merged.run(), 42);
  assert.deepEqual(merged.calls.filter(([method]) => method !== "tabs.query" && method !== "tabGroups.query"),
    [["tabs.move", "[2]"], ["tabs.group", '{"groupId":7,"tabIds":[2]}']]);
  assert.deepEqual([...merged.state.groups.keys()], [7]);
  assert.equal(merged.state.tabs.find(tab => tab.id === 2)?.groupId, 7);
  const mixed = setup([[7, 42], [8, 43]], [
    { id: 1, groupId: 7, windowId: 42, url: urls[0] },
    { id: 4, groupId: -1, windowId: 42, url: "https://mail.example/" },
    { id: 2, groupId: 8, windowId: 43, url: urls[1] }]);
  assert.equal(await mixed.run(), 43);
  assert.deepEqual(mixed.state.tabs.find(tab => tab.id === 4), { id: 4, groupId: -1, windowId: 42, url: "https://mail.example/" });
  assert.deepEqual([...mixed.state.groups.keys()], [8]);
});
