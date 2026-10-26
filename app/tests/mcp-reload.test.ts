import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "./temporary.js";
import { Agents } from "../src/server/agents.js";
import { Store } from "../src/server/storage.js";
import { ModelService } from "../src/server/model-service.js";
import { replyToFixtureTitle } from "./model-request-fixture.js";
import { resourceChanges } from "../src/shared/reload.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const wait = async (check: () => boolean, message: string) => {
  const until = Date.now() + 20000;
  while (!check()) { assert.ok(Date.now() < until, message); await new Promise(resolve => setTimeout(resolve, 20)); }
};

test("MCP reload applies membership and same-name configuration changes without inference; malformed config preserves the applied baseline", { timeout: 120000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-mcp-reload-")), pi = join(root, "pi"), cwd = join(root, "project");
  mkdirSync(pi); mkdirSync(cwd);
  const previous = process.env.AXIOM_PI_DIR, previousNative = process.env.PI_CODING_AGENT_DIR, previousMode = process.env.AXIOM_EXECUTION_MODE;
  process.env.AXIOM_PI_DIR = pi; process.env.PI_CODING_AGENT_DIR = join(root, "native-auth"); process.env.AXIOM_EXECUTION_MODE = "managed";
  const script = join(root, "mcp.cjs"), log = join(root, "mcp.log"), config = join(pi, "mcp.json");
  writeFileSync(script, `const {createInterface}=require('node:readline'); const {appendFileSync}=require('node:fs');
const [log,label]=process.argv.slice(2); const record=kind=>appendFileSync(log,JSON.stringify({kind,label,pid:process.pid})+'\\n'); record('start');
createInterface({input:process.stdin}).on('close',()=>process.exit(0)).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;let result={};
if(m.method==='initialize')result={protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:label,version:'1'}};
if(m.method==='tools/list'){record('list');result={tools:[{name:'probe',description:'Stable tool schema',inputSchema:{type:'object',properties:{}}}]};}
if(m.method==='tools/call'){record('call');result={content:[{type:'text',text:label}]};}
setTimeout(()=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n'),m.method==='tools/list'?150:0);});`);
  const lines = () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const configure = (entries: Record<string, string>) => writeFileSync(config, JSON.stringify({ mcpServers: Object.fromEntries(Object.entries(entries).map(([name, label]) =>
    [name, { command: process.execPath, args: [script, log, label], exposure: "direct" }])) }));
  configure({});
  const requests: any[] = [];
  const http = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (replyToFixtureTitle(body, res)) return;
    requests.push(body);
    const tool = body.tools?.find((entry: any) => entry.function?.name?.startsWith("mcp__"));
    const call = tool && body.messages.at(-1)?.role !== "tool";
    const delta = call ? { role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function", function: { name: tool.function.name, arguments: "{}" } }] }
      : { role: "assistant", content: "Done" };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta, finish_reason: call ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: `http://127.0.0.1:${(http.address() as any).port}/v1`, models: [{ id: "fixture" }] } } }));
  writeFileSync(join(pi, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "loopback-only" } }));
  writeFileSync(join(pi, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  const store = new Store(root), agents = new Agents(store, new ModelService(root), () => {});
  try {
    const workspace = store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: cwd, authorized: true } }) as Workspace;
    const session = store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(session.id, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    const command = (op: string, params = {}) => agents.command({ op, requestId: randomUUID(), ...scope, params });
    const reload = async () => {
      const before = requests.length;
      await command("agent.reload"); await wait(() => !agents.reloads.active(scope), "MCP reload timed out");
      assert.equal(agents.reloads.state(scope)?.status, "completed", JSON.stringify(agents.reloads.state(scope)));
      assert.equal(requests.length, before, "cold reload never invokes a model");
      return agents.reloads.state(scope)!;
    };
    await reload();
    for (const entries of [{ alpha: "A1" }, { alpha: "A1", beta: "B1" }, { alpha: "A2", beta: "B1" }, { beta: "B1" }, {}] as Record<string, string>[]) {
      const previousPids = lines().filter(entry => entry.kind === "start").map(entry => entry.pid);
      configure(entries);
      const state = await reload();
      assert.deepEqual(agents.capabilities.state(scope).selection?.mcp, Object.keys(entries).sort());
      assert.deepEqual(state.after!.settings.filter(item => item.name.startsWith("MCP · ") && item.name !== "MCP · autoEnableCodemode").map(item => item.name), Object.keys(entries).sort().map(name => `MCP · ${name}`));
      if (entries.alpha === "A2") assert.ok(resourceChanges(state.before!.settings, state.after!.settings).changed.includes("MCP · alpha"), "same schema with changed connection args is still reported");
      await wait(() => previousPids.every(pid => { try { process.kill(pid, 0); return false; } catch { return true; } }), "old MCP processes were not closed");
      const before = requests.length;
      await command("prompt", { text: `Verify ${JSON.stringify(entries)}` });
      await wait(() => !agents.active(scope), "MCP verification prompt did not settle");
      assert.equal(agents.info(scope).run?.status, "completed");
      const tools = requests[before].tools?.map((entry: any) => entry.function.name).filter((name: string) => name.startsWith("mcp__")) ?? [];
      assert.deepEqual(tools.sort(), Object.keys(entries).sort().map(name => `mcp__${name}__probe`));
      if (Object.keys(entries).length) assert.match(JSON.stringify(requests.at(-1).messages.at(-1)), new RegExp(Object.values(entries)[0]));
    }
    configure({ alpha: "A3" }); await reload();
    const applied = agents.capabilities.state(scope), baseline = store.db.prepare("SELECT resources FROM session_reloads WHERE sessionId=?").get(session.id)!.resources;
    writeFileSync(config, "{ invalid json");
    await command("agent.reload"); await wait(() => !agents.reloads.active(scope), "invalid configuration reload did not settle");
    assert.equal(agents.reloads.state(scope)?.status, "failed");
    assert.match(agents.reloads.state(scope)?.error ?? "", /MCP 配置无法完整读取/);
    assert.deepEqual(agents.capabilities.state(scope), applied);
    assert.equal(store.db.prepare("SELECT resources FROM session_reloads WHERE sessionId=?").get(session.id)!.resources, baseline);
    configure({ alpha: "A4" });
    const recovered = await reload();
    assert.ok(resourceChanges(recovered.before!.settings, recovered.after!.settings).changed.includes("MCP · alpha"));
  } finally {
    await agents.close(); store.close(); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    if (previousNative === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousNative;
    if (previousMode === undefined) delete process.env.AXIOM_EXECUTION_MODE; else process.env.AXIOM_EXECUTION_MODE = previousMode;
    rmSync(root, { recursive: true, force: true });
  }
});
