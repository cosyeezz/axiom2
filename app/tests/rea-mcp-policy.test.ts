import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createMcpExtension } from "@earendil-works/pi-coding-agent";
import { StdioTransport } from "@earendil-works/pi-mcp";
import { tmpdir } from "./temporary.js";
import { createReaToolPolicy, reaResultData } from "../src/server/integrations/rea-tool-policy.js";
import { reaAutoBudget } from "../src/server/integrations/rea-budget.js";

// Exercise the installed Pi MCP registration, annotations, JSON-RPC and result
// mapping, rather than imitating its ToolDefinition output shape.
test("installed Pi MCP tools retain wire envelopes and safely upgrade through the REA policy", { timeout: 15000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-rea-wire-")), script = join(root, "server.cjs"), log = join(root, "calls.jsonl");
  writeFileSync(script, `const {createInterface}=require('node:readline');const {appendFileSync}=require('node:fs');
let calls=0,revision=0; const settings=[{setting:'regex.worker_heap_request_mib',value:128,minimum:7,maximum:16384,agent_editable:true,source:'default'}];
createInterface({input:process.stdin}).on('close',()=>process.exit(0)).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;let result={};
if(m.method==='initialize')result={protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'rea-fixture',version:'6.8.0'}};
if(m.method==='tools/list')result={tools:['inspect_analysis_settings','update_analysis_settings','search_strings'].map(name=>({name,description:name,annotations:{readOnlyHint:false,idempotentHint:true,destructiveHint:false,openWorldHint:false},inputSchema:{type:'object',properties:name==='search_strings'?{mode:{type:'string'},pattern:{type:'string'},hang:{type:'boolean'}}:{},additionalProperties:true}}))};
if(m.method==='tools/call'){const {name,arguments:args}=m.params;appendFileSync(${JSON.stringify(log)},JSON.stringify({name,args})+'\\n');let data;
if(name==='inspect_analysis_settings')data={revision,settings};
if(name==='update_analysis_settings'){if(args.expected_revision!==revision)throw Error('stale revision');for(const c of args.changes){settings[0].value=c.action==='reset'?128:c.value;settings[0].source=c.action==='reset'?'default':'runtime';}data={revision:++revision,settings};}
if(name==='search_strings'){if(args.hang)return;calls++;data=calls===1?{code:'resource_constraint',retryable:false,details:{operation:'search_strings',resource:'memory',limit:{setting:'regex.worker_heap_request_mib',effective_value:settings[0].value,minimum:7,maximum:16384,agent_editable:true,scope:'rea-runtime',rea_restart_required:false}}}:{heap:settings[0].value};}
result={content:[{type:'text',text:JSON.stringify(calls===1&&name==='search_strings'?{error:data}:data)}],...(calls===1&&name==='search_strings'?{isError:true}:{}),...(name==='inspect_analysis_settings'?{structuredContent:data}:{})};}
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`);
  const hooks = new Map<string, Function[]>(), tools = new Map<string, any>(), notifications: string[] = [];
  const newPolicy = () => createReaToolPolicy(root, { version: "6.8.0", budget: () => reaAutoBudget({ totalMiB: 16384, availableMiB: 12000, cpus: 12 }) });
  let policy = newPolicy();
  let transport: StdioTransport | undefined;
  const pi: any = {
    on: (name: string, handler: Function) => hooks.set(name, [...(hooks.get(name) ?? []), handler]),
    registerTool: (definition: any) => tools.set(definition.name, policy.wrap(definition)),
    registerToolRenderer: () => {}, registerCommand: () => {}, getMcpServers: () => [],
    getAllTools: () => [...tools.values()], getActiveTools: () => [], setActiveTools: () => {},
  };
  const ctx: any = { cwd: root, ui: { notify: (message: string) => notifications.push(message) },
    executeTool: async (name: string, args: any, options: any) => {
      const result = await tools.get(name).execute('nested', args, options.signal, undefined, ctx);
      return { result, isError: result.isError === true };
    } };
  const emit = async (name: string) => { for (const hook of hooks.get(name) ?? []) await hook({}, ctx); };
  const start = async () => {
    await createMcpExtension({
      createTransport: () => { transport = new StdioTransport({ command: process.execPath, args: [script] }); policy.attachTransport(transport); return transport; },
      loadConfig: () => ({ servers: [{ name: "rea", source: script, scope: "extension", config: { command: process.execPath, args: [script], enabled: true, exposure: "direct", timeout: 10 } }], errors: [] }),
      logPath: join(root, "mcp.log"),
    })(pi);
    await emit("session_start");
    const until = Date.now() + 8000;
    while (!tools.has("mcp__rea__search_strings")) {
      assert.ok(Date.now() < until, notifications.join("\n")); await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  try {
    await start();
    const tool = tools.get("mcp__rea__search_strings");
    assert.equal(tool.annotations.idempotentHint, true);
    const result = await tool.execute("wire", { mode: "regex", pattern: "needle" }, undefined, undefined, ctx);
    assert.deepEqual(reaResultData(result), { heap: 512 });
    assert.deepEqual(result.structuredContent, { content: [{ type: "text", text: '{"heap":512}' }] });
    const calls = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(calls.map(item => item.name), ["inspect_analysis_settings", "update_analysis_settings", "search_strings", "update_analysis_settings", "search_strings", "update_analysis_settings"]);
    assert.equal(calls.at(-1).args.expected_revision, 2);
    assert.equal(calls.at(-1).args.changes[0].action, "reset");
    const controller = new AbortController();
    const pending = tool.execute("cancel", { hang: true }, controller.signal, undefined, ctx);
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(pending);
    assert.equal(transport!.pid, undefined, "cancellation closes actual MCP process before releasing admission");
    await assert.rejects(tool.execute("after-cancel", {}, undefined, undefined, ctx), /已隔离|未连接/);
    assert.equal(existsSync(join(root, "integrations/rea/budget/active.json")), false, "a repeated call cannot manufacture an unknown owner record");
    const replacement = new StdioTransport({ command: process.execPath, args: [script] });
    assert.throws(() => policy.attachTransport(replacement), /连接已更换/);
    assert.equal(replacement.pid, undefined, "replacement is refused before spawning");
    // A deliberate capability reload uses a fresh policy, not implicit replay.
    await emit("session_shutdown"); hooks.clear(); tools.clear(); policy = newPolicy();
    await start();
    const secondController = new AbortController();
    const secondPending = tools.get("mcp__rea__search_strings").execute("second-cancel", { hang: true }, secondController.signal, undefined, ctx);
    setTimeout(() => secondController.abort(), 50);
    await assert.rejects(secondPending);
    assert.equal(transport!.pid, undefined);
    assert.equal(existsSync(join(root, "integrations/rea/budget/active.json")), false);
  } finally { await emit("session_shutdown"); await transport?.close(); rmSync(root, { recursive: true, force: true }); }
});
