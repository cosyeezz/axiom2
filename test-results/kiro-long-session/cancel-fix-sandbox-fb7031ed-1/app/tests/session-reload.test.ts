import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Agents } from "../src/server/agents.js";
import { Store } from "../src/server/storage.js";
import { ModelService } from "../src/server/model-service.js";
import { resourceChanges } from "../src/shared/reload.js";
import type { Workspace, Session } from "../src/shared/protocol.js";

const wait = async (check: () => boolean, message: string) => {
  const deadline = Date.now() + 20000;
  while (!check()) { assert.ok(Date.now() < deadline, message); await new Promise(r => setTimeout(r, 10)); }
};

test("native reload waits for the whole tool batch, refreshes prompts, continues once, and cold reload makes no request", { timeout: 60000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-native-reload-")), pi = join(root, "pi"), cwd = join(root, "project");
  for (const path of [pi, cwd, join(cwd, ".pi/extensions"), join(cwd, ".pi/skills/demo")]) mkdirSync(path, { recursive: true });
  const previous = process.env.AXIOM_PI_DIR, previousMode = process.env.AXIOM_EXECUTION_MODE;
  process.env.AXIOM_PI_DIR = pi; process.env.AXIOM_EXECUTION_MODE = "managed";
  const entered = join(root, "entered"), release = join(root, "release"), finished = join(root, "finished");
  const resources = (version: string) => {
    writeFileSync(join(cwd, "AGENTS.md"), `InstructionMarker${version}`);
    writeFileSync(join(cwd, ".pi/skills/demo/SKILL.md"), `---\nname: demo\ndescription: SkillMarker${version}\n---\nSkill content ${version}\n`);
    writeFileSync(join(cwd, ".pi/extensions/reload-fixture.ts"), `import { appendFileSync, existsSync } from 'node:fs';
export default function(pi) {
  pi.registerTool({ name:'checkpoint', label:'checkpoint', description:'ToolMarker${version}', parameters:{type:'object',properties:{}},
    async execute(id) { appendFileSync(${JSON.stringify(entered)}, id+'\\n'); while (!existsSync(${JSON.stringify(release)})) await new Promise(r=>setTimeout(r,10)); appendFileSync(${JSON.stringify(finished)}, id+'\\n'); return {content:[{type:'text',text:'batch completed'}],details:{}}; } });
}`);
    writeFileSync(join(pi, "settings.json"), JSON.stringify({ compaction: { enabled: false }, retry: { enabled: false }, quietStartup: version === "V2" }));
  };
  resources("V1");
  const mcpLog = join(root, "mcp-log"), mcpScript = join(root, "mcp-fixture.cjs");
  writeFileSync(mcpScript, `const {createInterface}=require('node:readline'); const {appendFileSync}=require('node:fs');
const log=${JSON.stringify(mcpLog)}; appendFileSync(log,'started\\n');
createInterface({input:process.stdin}).on('line',line=>{ const m=JSON.parse(line); if(m.id===undefined)return;
let result={}; if(m.method==='initialize')result={protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'reload-fixture',version:'1'}};
if(m.method==='tools/list'){appendFileSync(log,'listed\\n');result={tools:[{name:'reload_probe',description:'McpReloadMarker',inputSchema:{type:'object',properties:{}}}]};}
if(m.method==='tools/call')result={content:[{type:'text',text:'mcp result'}]};
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n'); });`);
  writeFileSync(join(pi, "mcp.json"), JSON.stringify({ mcpServers: { "reload-mcp": { command: process.execPath, args: [mcpScript], enabled: false, exposure: "direct" } } }));
  const requests: any[] = [];
  const http = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    requests.push(JSON.parse(raw));
    const first = requests.length === 1;
    if (requests.length === 2) {
      const deadline = Date.now() + 10000;
      while ((!existsSync(mcpLog) || !readFileSync(mcpLog, "utf8").includes("listed")) && Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    const delta = first ? { role: "assistant", tool_calls: [0, 1].map(index => ({ index, id: `call-${index}`, type: "function", function: { name: "checkpoint", arguments: "{}" } })) } : { role: "assistant", content: "Reload continued successfully." };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta, finish_reason: first ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(r => http.listen(0, "127.0.0.1", r));
  writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: `http://127.0.0.1:${(http.address() as any).port}/v1`, models: [{ id: "fixture", contextWindow: 32000, maxTokens: 256 }] } } }));
  writeFileSync(join(pi, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "loopback-only" } }));
  const store = new Store(root), agents = new Agents(store, new ModelService(root), () => {});
  try {
    const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: cwd, authorized: true } }) as Workspace;
    const session = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(session.id, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    const command = (op: string, params = {}, requestId = randomUUID()) => agents.command({ requestId, op, ...scope, params });
    mkdirSync(join(cwd, ".pi/skills/beta"), { recursive: true });
    writeFileSync(join(cwd, ".pi/skills/beta/SKILL.md"), "---\nname: beta\ndescription: BetaReloadMarker\n---\nBeta guide");
    const toggleSkill = async (name: string, checked: boolean) => {
      const catalog = await agents.capabilities.get(scope), item = catalog.skills.find(item => item.name === name)!;
      await agents.capabilities.command({ requestId: randomUUID(), op: "capabilities.defaults.save", ...scope,
        params: { revision: catalog.preferencesRevision, catalogRevision: catalog.revision, kind: "skills", id: item.id, checked } });
      return item.id;
    };
    const batch = async (target: "session" | "defaults", skills: string[], mcp: string[]) => {
      const catalog = await agents.capabilities.get(scope);
      return { capabilities: { target, revision: target === "session" ? catalog.state.revision : catalog.preferencesRevision,
        catalogRevision: catalog.revision, skills, mcp } };
    };
    const betaId = await toggleSkill("beta", false);
    await command("prompt", { text: "Run both checkpoint tools and finish." });
    await wait(() => existsSync(entered), "first tool never started");
    const runId = agents.info(scope).run!.id;
    const requestId = randomUUID();
    const beforeBatch = agents.capabilities.state(scope), defaultsBeforeBatch = agents.capabilities.preferences();
    const selection = await batch("session", (await agents.capabilities.get(scope)).skills.map(item => item.id), ["reload-mcp"]);
    assert.ok(!beforeBatch.selection?.skills?.includes(betaId));
    await command("agent.reload", selection, requestId);
    assert.equal(agents.reloads.state(scope)?.stage, "waiting");
    await command("agent.reload", selection, requestId);
    await assert.rejects(command("agent.reload", selection), { code: "RELOAD_BUSY" });
    await command("agent.reload");
    assert.equal(agents.reloads.state(scope)?.id, requestId, "duplicates coalesce while running");
    assert.deepEqual(agents.capabilities.state(scope), beforeBatch);
    assert.deepEqual(agents.capabilities.preferences(), defaultsBeforeBatch);
    assert.equal(requests.length, 1);
    assert.equal(existsSync(finished), false, "reload must not interrupt a tool");
    resources("V2"); writeFileSync(release, "go");
    await wait(() => !agents.active(scope), "reloaded run did not settle");
    assert.equal(agents.info(scope).run?.status, "completed", JSON.stringify(agents.info(scope).run));
    const state = agents.reloads.state(scope)!;
    assert.equal(state.status, "completed", JSON.stringify(state)); assert.equal(state.resumed, true);
    assert.equal(agents.info(scope).run!.id, runId);
    assert.equal(requests.length, 2, "one continuation, no replay or synthetic run");
    for (const request of requests) {
      const prompt = JSON.stringify(request.messages);
      assert.match(prompt, /You are an AI assistant in Axiom/);
      assert.match(prompt, /<tools>/);
      assert.match(prompt, /<rules>/);
      assert.match(prompt, /Read file contents/);
      assert.match(prompt, /Be concise in your responses/);
      assert.doesNotMatch(prompt, /<docs>|Pi documentation \(read only/);
    }
    assert.match(JSON.stringify(requests[0].messages), /InstructionMarkerV1/);
    assert.match(JSON.stringify(requests[1].messages), /InstructionMarkerV2/);
    assert.match(JSON.stringify(requests[1].messages), /SkillMarkerV2/);
    assert.doesNotMatch(JSON.stringify(requests[0].messages), /BetaReloadMarker/);
    assert.match(JSON.stringify(requests[1].messages), /BetaReloadMarker/);
    assert.ok(agents.capabilities.state(scope).selection?.skills?.includes(betaId));
    assert.deepEqual(agents.capabilities.state(scope).selection?.mcp, ["reload-mcp"]);
    assert.deepEqual(agents.capabilities.preferences(), defaultsBeforeBatch, "session batch does not save global defaults");
    await wait(() => existsSync(mcpLog) && readFileSync(mcpLog, "utf8").includes("listed"), "first MCP was not connected by native reload");
    assert.match(JSON.stringify(requests[1].tools), /ToolMarkerV2/);
    assert.match(JSON.stringify(requests[1].tools), /mcp__reload_mcp__reload_probe/);
    assert.ok(state.after!.settings.some(item => item.name === "MCP · reload-mcp"));
    assert.doesNotMatch(JSON.stringify(requests[1].messages), /axiom-resume/);
    assert.deepEqual(readFileSync(finished, "utf8").trim().split("\n").sort(), ["call-0", "call-1"]);
    assert.deepEqual(requests[1].messages.filter((m: any) => m.role === "user"), requests[0].messages.filter((m: any) => m.role === "user"), "no invented user turn");
    assert.ok(resourceChanges(state.before!.skills, state.after!.skills).changed.some(name => name.includes("demo")));
    assert.ok(resourceChanges(state.before!.instructions, state.after!.instructions).changed.length);
    assert.ok(resourceChanges(state.before!.settings, state.after!.settings).changed.includes("quietStartup"));
    const count = store.db.prepare("SELECT COUNT(*) AS count FROM runs").get()!.count;
    resources("V3");
    await command("agent.reload", await batch("defaults", [], []));
    await wait(() => !agents.reloads.active(scope), "cold reload did not settle");
    assert.equal(agents.reloads.state(scope)?.status, "completed", JSON.stringify(agents.reloads.state(scope)));
    assert.equal(requests.length, 2); assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM runs").get()!.count, count);
    assert.match(agents.info(scope).environment!.systemPrompt!, /InstructionMarkerV3/);
    assert.ok(["demo", "beta"].every(name => agents.info(scope).environment!.skills!.includes(name)), "empty automatic selection keeps manual skills loaded");
    assert.ok(resourceChanges(agents.reloads.state(scope)!.before!.skills, agents.reloads.state(scope)!.after!.skills).changed.some(name => name.includes("beta")), "selection-only changes are reported");
    assert.deepEqual(resourceChanges(agents.reloads.state(scope)!.before!.skills, agents.reloads.state(scope)!.after!.skills).removed, []);
    assert.deepEqual(agents.capabilities.state(scope).selection?.skills, []);
    assert.deepEqual(agents.capabilities.state(scope).selection?.mcp, []);
    const savedDefaults = await agents.capabilities.get(scope);
    assert.ok(savedDefaults.skills.every(item => !item.defaultSelected));
    assert.ok(savedDefaults.mcp.every(item => !item.defaultSelected));
    assert.equal(savedDefaults.preferencesRevision, defaultsBeforeBatch.revision + 1, "one atomic default save for the batch");
    assert.ok(!agents.info(scope).environment!.tools?.some(name => name.includes("reload_probe")));
    await command("prompt", { text: "One more response." });
    await wait(() => !agents.active(scope), "prompt after cold reload did not settle");
    assert.equal(requests.length, 3); assert.match(JSON.stringify(requests[2].messages), /InstructionMarkerV3/);
    assert.doesNotMatch(JSON.stringify(requests[2].messages.filter((m: any) => m.role === "system")), /SkillMarker|BetaReloadMarker/);
    // Resource lifecycle extensions cannot turn a cold reload into inference.
    writeFileSync(join(cwd, ".pi/extensions/reload-fixture.ts"), `export default function(pi) { pi.on('session_start', () => { pi.sendUserMessage('must not infer during reload'); }); }`);
    await command("agent.reload");
    await wait(() => !agents.reloads.active(scope), "cold lifecycle did not settle");
    assert.equal(requests.length, 3, "session_start must not infer during a reload");
    // A hanging reload can be stopped without waiting for its 120s deadline.
    const blocked = join(root, "reload-blocked");
    const appliedBeforeFailure = agents.capabilities.state(scope);
    const resourcesBeforeFailure = store.db.prepare("SELECT resources FROM session_reloads WHERE sessionId=?").get(session.id)!.resources;
    const defaultsBeforeFailure = agents.capabilities.preferences();
    writeFileSync(join(cwd, ".pi/extensions/reload-fixture.ts"), `import { writeFileSync } from 'node:fs'; export default function(pi) { pi.on('session_start', async e => { if(e.reason==='reload') { writeFileSync(${JSON.stringify(blocked)}, 'blocked'); await new Promise(()=>{}); } }); }`);
    await command("agent.reload", await batch("defaults", [betaId], ["reload-mcp"]));
    await wait(() => existsSync(blocked), "reload hook not entered");
    const stopping = Date.now(); await agents.stop(scope);
    assert.ok(Date.now() - stopping < 5000, "stop must cancel the cold lease promptly");
    assert.equal(agents.reloads.state(scope)?.status, "failed");
    assert.deepEqual(agents.capabilities.state(scope), appliedBeforeFailure, "failed reload cannot publish desired members as applied");
    assert.deepEqual(agents.capabilities.preferences(), defaultsBeforeFailure, "failed reload does not save global defaults");
    assert.equal(store.db.prepare("SELECT resources FROM session_reloads WHERE sessionId=?").get(session.id)!.resources, resourcesBeforeFailure, "failed reload cannot replace the successful resource baseline");
    assert.equal(agents.reloads.active(scope), false); assert.equal(requests.length, 3);
    const child = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,status,budgets,createdAt) VALUES(?,?,?,?,?,'reload child','completed','{}',?)")
      .run(randomUUID(), workspace.id, session.id, child.id, "reload-fixture", Date.now());
    store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(child.id, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    const childScope = { workspaceId: workspace.id, sessionId: child.id };
    for (const target of ["session", "defaults"] as const) await assert.rejects(agents.command({ requestId: randomUUID(), op: "agent.reload", ...childScope,
      params: await batch(target, [], []) }), { code: "CAPABILITIES_READONLY" });
    for (const capabilities of [{ ...(await batch("session", [], [])).capabilities, extra: true },
      { ...(await batch("session", [], [])).capabilities, skills: [betaId, betaId] }])
      await assert.rejects(command("agent.reload", { capabilities }), { code: "INVALID_INPUT" });
    await agents.command({ requestId: randomUUID(), op: "agent.reload", ...childScope, params: {} });
    await wait(() => !agents.reloads.active(childScope), "child cold reload did not settle");
    assert.equal(agents.reloads.state(childScope)?.status, "completed", JSON.stringify(agents.reloads.state(childScope)));
    assert.ok(!agents.info(childScope).environment!.tools!.some(name => ["edit", "write", "delegate", "checkpoint", "memory_query"].includes(name)));
    const childSkills = agents.info(childScope).environment!.skills ?? [];
    assert.ok(childSkills.includes("demo"), "child keeps normal project skills");
    assert.ok(!childSkills.some(name => ["opencli-usage", "opencli-browser"].includes(name)), "child must not load browser automation skills");
    assert.equal(requests.length, 3);
  } finally {
    writeFileSync(release, "cleanup");
    await agents.close(); store.close(); http.closeAllConnections(); await new Promise<void>(r => http.close(() => r()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    if (previousMode === undefined) delete process.env.AXIOM_EXECUTION_MODE; else process.env.AXIOM_EXECUTION_MODE = previousMode;
    rmSync(root, { recursive: true, force: true });
  }
});
