import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "./temporary.js";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Agents } from "../src/server/agents.js";
import { Store } from "../src/server/storage.js";
import { ModelService } from "../src/server/model-service.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const wait = async (check: () => boolean, message: string) => {
  const end = Date.now() + 20000;
  while (!check()) { assert.ok(Date.now() < end, message); await new Promise(resolve => setTimeout(resolve, 10)); }
};
for (const mode of ["section patches", "forced", "folded"] as const) test(`live skill discovery preserves tools, MCP and extension prompts (${mode})`, { timeout: 90000 }, async () => {
  const forced = mode === "forced";
  const root = mkdtempSync(join(tmpdir(), "axiom-live-skills-")), cwd = join(root, "project"), piDir = join(root, "pi");
  for (const path of [piDir, join(cwd, ".pi/extensions"), join(cwd, ".pi/skills/alpha"), join(cwd, ".pi/skills/beta")]) mkdirSync(path, { recursive: true });
  const previous = process.env.AXIOM_PI_DIR, previousMode = process.env.AXIOM_EXECUTION_MODE;
  process.env.AXIOM_PI_DIR = piDir; process.env.AXIOM_EXECUTION_MODE = "managed";
  const skillFile = (name: string) => join(cwd, ".pi/skills", name, "SKILL.md");
  for (const name of ["alpha", "beta"]) writeFileSync(skillFile(name), `---\nname: ${name}\ndescription: ${name.toUpperCase()}_DISCOVERY\n${name === "beta" ? "disable-model-invocation: true\n" : ""}---\n${name.toUpperCase()}_BODY`);
  const betaSource = readFileSync(skillFile("beta"), "utf8");
  writeFileSync(join(cwd, "AGENTS.md"), "PROJECT_ORIGINAL");
  const lifecycle = join(root, "lifecycle"), entered = (n: number) => join(root, `entered-${n}`), release = (n: number) => join(root, `release-${n}`);
  writeFileSync(join(cwd, ".pi/extensions/checkpoint.ts"), `import {appendFileSync,writeFileSync,existsSync} from 'node:fs';
export default pi => {
  pi.on('session_start', () => appendFileSync(${JSON.stringify(lifecycle)}, 'start\\n'));
  pi.on('session_shutdown', () => appendFileSync(${JSON.stringify(lifecycle)}, 'shutdown\\n'));
  pi.on('before_agent_start', e => { e.systemPromptOptions.sections.extension_fixture = 'EXTENSION_PRESERVED';
    ${forced ? "return {systemPrompt: e.systemPrompt + '\\nFORCED_PRESERVED'};" : ""} });
  pi.registerTool({name:'checkpoint',label:'checkpoint',description:'CHECKPOINT_ORIGINAL',parameters:{type:'object',properties:{n:{type:'number'}},required:['n']},
    async execute(id, {n}, signal) { writeFileSync(${JSON.stringify(root)}+'/entered-'+n, id); while(!existsSync(${JSON.stringify(root)}+'/release-'+n)) { if(signal?.aborted) throw Error('stopped'); await new Promise(r=>setTimeout(r,10)); } return {content:[{type:'text',text:'completed '+n}],details:{}}; }
  });
}`);
  let connections = 0;
  const requests: any[] = [], gates = new Map([[1, 1], [2, 2]]);
  const http = createServer(async (req, res) => {
    if (req.method === "GET" || req.method === "DELETE") { res.writeHead(405); res.end(); return; }
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (req.url === "/mcp") {
      if (body.method === "initialize") connections++;
      if (body.id === undefined) { res.writeHead(202); res.end(); return; }
      const result = body.method === "initialize" ? { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } }
        : body.method === "tools/list" ? { tools: [{ name: "ping", description: "MCP_PRESERVED", inputSchema: { type: "object", properties: {} } }] } : {};
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result })); return;
    }
    requests.push(body);
    const n = gates.get(requests.length);
    const delta = n ? { role: "assistant", tool_calls: (n === 1 ? [1, 11] : [n]).map((gate, index) => ({ index, id: `call-${gate}`, type: "function", function: { name: "checkpoint", arguments: JSON.stringify({ n: gate }) } })) } : { role: "assistant", content: "Finished." };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta, finish_reason: n ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(http.address() as any).port}`;
  writeFileSync(join(piDir, "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: `${base}/v1`, models: [{ id: "fixture", contextWindow: 32000, maxTokens: 256, compat: { supportsMidConvoSystemMessages: mode !== "folded" } }] } } }));
  writeFileSync(join(piDir, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "loopback" } }));
  writeFileSync(join(piDir, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  const mcpSource = JSON.stringify({ mcpServers: { fixture: { url: `${base}/mcp`, exposure: "direct" } } });
  writeFileSync(join(piDir, "mcp.json"), mcpSource);
  let store = new Store(root), agents = new Agents(store, new ModelService(root), () => {});
  try {
    const workspace = store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: cwd, authorized: true } }) as Workspace;
    const session = store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    let signalled = 0;
    const signal = agents.signal.bind(agents);
    agents.signal = (...args) => { const sent = signal(...args); if (sent && args[2].type === "reload") signalled++; return sent; };
    const command = (op: string, params = {}, requestId = randomUUID()) => agents.command({ op, requestId, ...scope, params });
    const toggle = async (name: string, checked: boolean) => {
      const catalog = await agents.capabilities.get(scope), item = catalog.skills.find(item => item.name === name)!;
      await command("agent.skills", { revision: catalog.state.revision, catalogRevision: catalog.revision, id: item.id, checked });
      return item.id;
    };
    // Idle choices do not require a model, initialize an SDK session, or connect MCP.
    const betaId = await toggle("beta", true);
    await wait(() => !agents.reloads.active(scope), "idle save");
    assert.equal(agents.reloads.state(scope)?.status, "completed");
    assert.equal(agents.capabilities.state(scope).locked, false); assert.equal(connections, 0); assert.equal(requests.length, 0);
    await toggle("beta", false); await wait(() => !agents.reloads.active(scope), "idle reset");
    store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?)").run(session.id, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    await command("prompt", { text: "Complete checkpoint work." });
    await wait(() => existsSync(entered(1)), "first tool");
    const runId = agents.info(scope).run!.id, applied = agents.capabilities.state(scope), defaults = agents.capabilities.preferences();
    assert.equal(connections, 1);
    const catalog = await agents.capabilities.get(scope);
    await toggle("beta", true);
    await wait(() => agents.reloads.state(scope)?.stage === "waiting", "waiting for tool boundary");
    assert.deepEqual(agents.capabilities.state(scope), applied, "pending selection is not published as applied");
    await assert.rejects(command("agent.reload"), { code: "RELOAD_BUSY" });
    await assert.rejects(command("agent.skills", { revision: applied.revision, catalogRevision: catalog.revision, id: betaId, checked: false }), { code: "RELOAD_BUSY" });
    // Unrelated resources must not be refreshed as a side effect of a skill toggle.
    writeFileSync(join(cwd, "AGENTS.md"), "PROJECT_CHANGED_MUST_NOT_LOAD");
    writeFileSync(release(1), "go");
    await wait(() => existsSync(entered(11)), "second tool in the same batch");
    assert.equal(requests.length, 1); assert.deepEqual(agents.capabilities.state(scope), applied);
    assert.equal(agents.reloads.state(scope)?.status, "running", "one completed tool is not the batch boundary");
    writeFileSync(release(11), "go");
    await wait(() => existsSync(entered(2)), "second request after discovery change");
    assert.equal(agents.reloads.state(scope)?.status, "completed", JSON.stringify(agents.reloads.state(scope)));
    assert.ok(agents.capabilities.state(scope).selection?.skills?.includes(betaId));
    assert.equal(agents.info(scope).run!.id, runId);
    assert.equal(connections, 1); assert.equal(readFileSync(lifecycle, "utf8"), "start\n");
    assert.deepEqual(requests[1].tools, requests[0].tools);
    assert.match(JSON.stringify(requests[1].messages), /BETA_DISCOVERY/);
    assert.match(JSON.stringify(requests[1].messages), forced ? /FORCED_PRESERVED/ : /EXTENSION_PRESERVED/);
    assert.doesNotMatch(JSON.stringify(requests[1].messages), /PROJECT_CHANGED_MUST_NOT_LOAD/);
    if (mode !== "section patches") assert.notDeepEqual(requests[1].messages[0], requests[0].messages[0]);
    else {
      assert.deepEqual(requests[1].messages.slice(0, requests[0].messages.length), requests[0].messages, "skill delta preserves the earlier request prefix");
      assert.match(JSON.stringify(requests[1].messages.filter((m: any) => m.role === "system").at(-1)), /Updated system prompt section.*skills/);
    }
    assert.deepEqual(agents.capabilities.preferences(), defaults, "current session changes leave global preferences untouched");
    // Even malformed MCP configuration cannot block a skill-only change or restart its connection.
    writeFileSync(join(piDir, "mcp.json"), "{ invalid");
    const signalsBeforeRemoval = signalled;
    await toggle("beta", false);
    await wait(() => signalled > signalsBeforeRemoval, "removal reaches worker before releasing the tool");
    writeFileSync(release(2), "go");
    await wait(() => !agents.active(scope), "run completes");
    assert.equal(agents.info(scope).run?.status, "completed", agents.info(scope).run?.error ?? undefined);
    assert.equal(requests.length, 3); assert.equal(connections, 1);
    assert.equal(agents.reloads.state(scope)?.status, "completed");
    assert.ok(!agents.capabilities.state(scope).selection?.skills?.includes(betaId));
    assert.deepEqual(agents.capabilities.state(scope).selection?.mcp, ["fixture"]);
    assert.doesNotMatch(JSON.stringify(requests[2].messages.filter((m: any) => m.role === "system").at(-1)), /BETA_DISCOVERY/);
    assert.equal(readFileSync(skillFile("beta"), "utf8"), betaSource, "shared frontmatter is unchanged");
    assert.deepEqual(requests[2].messages.filter((m: any) => m.role === "user"), requests[0].messages.filter((m: any) => m.role === "user"));
    const stale = agents.capabilities.state(scope);
    await command("agent.skills", { revision: applied.revision, catalogRevision: (await agents.capabilities.get(scope)).revision, id: betaId, checked: true });
    await wait(() => !agents.reloads.active(scope), "stale selection rejected");
    assert.equal(agents.reloads.state(scope)?.status, "failed"); assert.deepEqual(agents.capabilities.state(scope), stale);
    writeFileSync(join(piDir, "mcp.json"), mcpSource);
    const count = requests.length;
    await toggle("beta", true); await wait(() => !agents.reloads.active(scope), "completed-session idle save");
    assert.equal(requests.length, count); assert.equal(connections, 1);
    // A failed application must retain the last confirmed selection.
    gates.set(requests.length + 1, 3);
    await command("prompt", { text: "Check failure handling." });
    await wait(() => existsSync(entered(3)), "failure checkpoint");
    const beforeFailure = agents.capabilities.state(scope), signalsBeforeFailure = signalled;
    await toggle("alpha", false);
    await wait(() => signalled > signalsBeforeFailure, "skill change reaches worker");
    rmSync(skillFile("beta")); writeFileSync(release(3), "go");
    await wait(() => !agents.active(scope), "failed application settles");
    assert.equal(agents.reloads.state(scope)?.status, "failed");
    assert.deepEqual(agents.capabilities.state(scope), beforeFailure);
    writeFileSync(skillFile("beta"), betaSource);
    const saved = agents.capabilities.state(scope);
    await agents.close(); store.close(); store = new Store(root); agents = new Agents(store, new ModelService(root), () => {});
    assert.deepEqual(agents.capabilities.state(scope), saved, "session choices persist after restart");
    const child = store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id }) as Session;
    store.db.prepare("INSERT INTO tasks(id,workspaceId,parentSessionId,sessionId,anchor,description,status,budgets,createdAt) VALUES(?,?,?,?,?,'child','completed','{}',?)")
      .run(randomUUID(), workspace.id, session.id, child.id, "fixture", Date.now());
    const childScope = { ...scope, sessionId: child.id }, childCatalog = await agents.capabilities.get(childScope);
    assert.equal(childCatalog.sessionSkillsEditable, false);
    await assert.rejects(agents.command({ op: "agent.skills", requestId: randomUUID(), ...childScope,
      params: { revision: childCatalog.state.revision, catalogRevision: childCatalog.revision, id: betaId, checked: true } }), { code: "CAPABILITIES_READONLY" });
  } finally {
    for (const n of [1, 2, 3, 11]) writeFileSync(release(n), "cleanup");
    await agents.close(); store.close(); http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    if (previousMode === undefined) delete process.env.AXIOM_EXECUTION_MODE; else process.env.AXIOM_EXECUTION_MODE = previousMode;
    rmSync(root, { recursive: true, force: true });
  }
});
