import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { startServer } from "../src/server/index.js";
import { running } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
const wait = async (check: () => boolean) => {
  const end = Date.now() + 25000;
  while (!check()) { if (Date.now() > end) throw Error("fixture timed out"); await new Promise(resolve => setTimeout(resolve, 25)); }
};
test("all catalog skills stay manually usable, automatic selection controls the prompt, and MCP locks survive restart", { timeout: 120000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-capabilities-worker-")), cwd = join(root, "项目 workspace"), modelDir = join(root, "共享 Pi agent");
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = relative(process.cwd(), modelDir);
  mkdirSync(modelDir, { recursive: true });
  for (const name of ["chosen-skill", "unused-skill"]) {
    mkdirSync(join(cwd, ".pi", "skills", name), { recursive: true });
    writeFileSync(join(cwd, ".pi", "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} marker\n${name === "unused-skill" ? "disable-model-invocation: true\n" : ""}---\n${name === "unused-skill" ? "MANUAL_ONLY_BODY" : "Instructions"}`);
  }
  mkdirSync(join(modelDir, "skills", "shared-chosen"), { recursive: true });
  writeFileSync(join(modelDir, "skills", "shared-chosen", "SKILL.md"), "---\nname: shared-chosen\ndescription: shared-chosen marker\n---\nInstructions");
  const extraSkills = [
    { name: "shared-unused", dir: join(modelDir, "skills", "shared-unused") },
    { name: "global-unused", dir: join(root, "pi", "skills", "global-unused") },
    { name: "agents-unused", dir: join(cwd, ".agents", "skills", "agents-unused") },
    { name: "extension-unused", dir: join(root, "extension-skill") },
  ];
  for (const { name, dir } of extraSkills) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} marker\n---\nInstructions`);
  }
  const discoveryLog = join(root, "discovery-events.txt");
  const discoveryCount = () => existsSync(discoveryLog) ? readFileSync(discoveryLog, "utf8").trim().split("\n").length : 0;
  let connections = 0, calls = 0, blockedConnections = 0;
  const requests: any[] = [];
  const assertRequestSelection = (request: any, selected: boolean) => {
    const prompt = JSON.stringify(request.messages);
    for (const name of ["unused-skill", ...extraSkills.map(item => item.name)])
      assert.ok(!prompt.includes(`${name} marker`), `${name} must not enter the model prompt`);
    assert.equal(prompt.includes("chosen-skill marker"), selected);
    assert.equal(prompt.includes("shared-chosen marker"), selected);
    const mcpTools = request.tools.map((tool: any) => tool.function.name).filter((name: string) => name.startsWith("mcp__"));
    assert.deepEqual(mcpTools, selected ? ["mcp__chosen__ping"] : []);
  };
  const fixture = createServer(async (req, res) => {
    if (req.method === "GET" || req.method === "DELETE") { res.writeHead(405); res.end(); return; }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (req.url?.startsWith("/mcp")) {
      if (req.url === "/mcp-unused") blockedConnections++;
      if (body.method === "initialize") connections++;
      if (body.method === "tools/call") calls++;
      if (body.id === undefined) { res.writeHead(202); res.end(); return; }
      const result = body.method === "initialize" ? { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } }
        : body.method === "tools/list" ? { tools: [{ name: "ping", description: "MCP fixture", inputSchema: { type: "object", properties: {} } }] }
        : body.method === "tools/call" ? { content: [{ type: "text", text: "selected MCP result" }] } : {};
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result })); return;
    }
    requests.push(body);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const delta = requests.length === 1 ? { role: "assistant", tool_calls: [{ index: 0, id: "selected-tool", type: "function", function: { name: "mcp__chosen__ping", arguments: "{}" } }] }
      : { role: "assistant", content: "Verified." };
    res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: {}, finish_reason: requests.length === 1 ? "tool_calls" : "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(fixture.address() as any).port}`;
  writeFileSync(join(modelDir, "models.json"), JSON.stringify({ providers: { "capability-fixture": { api: "openai-completions", baseUrl: `${base}/v1`, models: [{ id: "fixture", name: "Fixture" }] } } }));
  writeFileSync(join(modelDir, "auth.json"), JSON.stringify({ "capability-fixture": { type: "api_key", key: "fixture" } }));
  mkdirSync(join(root, "pi"), { recursive: true });
  writeFileSync(join(root, "pi", "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  writeFileSync(join(root, "pi", "mcp.json"), JSON.stringify({ mcpServers: {
    "app-only": { url: `${base}/mcp-unused`, exposure: "direct" },
  } }));
  writeFileSync(join(modelDir, "mcp.json"), JSON.stringify({ mcpServers: {
    chosen: { url: `${base}/mcp`, exposure: "direct" }, unused: { url: `${base}/mcp-unused`, exposure: "direct" },
  } }));
  // Native extension registrations must not bypass the static selected list.
  mkdirSync(join(cwd, ".pi", "extensions"));
  writeFileSync(join(cwd, ".pi", "extensions", "mcp-register.ts"), `import { appendFileSync } from "node:fs";
  export default pi => {
    pi.on("resources_discover", () => {
      appendFileSync(${JSON.stringify(discoveryLog)}, "called\\n");
      return { skillPaths: [${JSON.stringify(join(root, "extension-skill", "SKILL.md"))}] };
    });
    pi.registerMcpServer("registered", { url: "${base}/mcp-unused", exposure: "direct" });
    pi.on("agent_start", () => pi.registerMcpServer("late", { url: "${base}/mcp-unused", exposure: "direct" }));
  };`);
  let app: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    app = await startServer({ root, port: 0 });
    const w = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: cwd, authorized: true } }) as Workspace;
    const s = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: w.id }) as Session;
    const scope = { workspaceId: w.id, sessionId: s.id };
    await assert.rejects(app.agents.command({ op: "prompt", requestId: randomUUID(), ...scope, params: { text: "no model" } }), { code: "MODEL_UNAVAILABLE" });
    assert.equal(app.agents.capabilities.state(scope).locked, false);
    const catalog = await app.agents.capabilities.get(scope);
    assert.deepEqual(catalog.mcpPaths, [join(modelDir, "mcp.json"), join(w.path, ".pi", "mcp.json")]);
    assert.ok(catalog.mcp.some(item => item.id === "chosen"));
    assert.ok(!catalog.mcp.some(item => item.id === "app-only"), "uses the configured shared Pi directory, not the application resource directory");
    assert.equal(connections, 0, "catalog does not connect MCP");
    const selectedSkill = catalog.skills.find(item => item.name === "chosen-skill")!;
    const sharedSkill = catalog.skills.find(item => item.name === "shared-chosen")!;
    assert.equal(sharedSkill?.source, join(modelDir, "skills", "shared-chosen", "SKILL.md"));
    const selectedIds = [selectedSkill.id, sharedSkill.id].sort();
    const allSkillNames = catalog.skills.map(item => item.name).sort();
    const manualSkill = catalog.skills.find(item => item.name === "unused-skill")!;
    assert.equal(manualSkill.defaultSelected, false, "frontmatter defines the initial automatic preference");
    const manualSource = readFileSync(manualSkill.source, "utf8");
    assert.ok(catalog.skills.some(item => item.name === "shared-unused"));
    assert.ok(catalog.skills.some(item => item.name === "global-unused"));
    assert.ok(catalog.skills.some(item => item.name === "agents-unused"));
    assert.ok(!catalog.skills.some(item => item.name === "extension-unused"));
    await app.agents.capabilities.command({ op: "capabilities.save", requestId: randomUUID(), ...scope,
      params: { revision: catalog.state.revision, catalogRevision: catalog.revision, skills: selectedIds, mcp: ["chosen"] } });
    const selection = { provider: "capability-fixture", id: "fixture", thinking: "off" };
    await app.agents.command({ op: "agent.model", requestId: randomUUID(), ...scope, params: { selection } });
    await app.agents.command({ op: "prompt", requestId: randomUUID(), ...scope, params: { text: "Use selected MCP" } });
    await wait(() => !running(app!.agents.info(scope).run));
    assert.equal(app.agents.info(scope).run?.status, "completed", app.agents.info(scope).run?.error ?? undefined);
    assert.equal(app.agents.capabilities.state(scope).locked, true);
    assert.equal(connections, 1); assert.equal(calls, 1); assert.equal(blockedConnections, 0);
    assert.ok(discoveryCount() > 0, "extension resource discovery actually ran");
    const first = requests[0];
    assertRequestSelection(first, true);
    assert.ok(first.tools.some((tool: any) => tool.function.name === "mcp__chosen__ping"));
    assert.ok(!first.tools.some((tool: any) => /unused|registered|late/.test(tool.function.name)));
    assert.ok(JSON.stringify(first.messages).includes("chosen-skill marker"));
    assert.ok(!JSON.stringify(first.messages).includes("unused-skill marker"));
    assert.deepEqual([...app.agents.info(scope).environment!.skills].sort(), allSkillNames);
    await assert.rejects(app.agents.capabilities.command({ op: "capabilities.save", requestId: randomUUID(), ...scope,
      params: { revision: app.agents.capabilities.state(scope).revision, catalogRevision: catalog.revision, skills: [], mcp: [] } }), { code: "CAPABILITIES_LOCKED" });
    await app.agents.command({ op: "prompt", requestId: randomUUID(), ...scope, params: { text: "Continue" } });
    await wait(() => !running(app!.agents.info(scope).run));
    assert.equal(app.agents.info(scope).run?.status, "completed");
    assertRequestSelection(requests.at(-1), true);
    assert.deepEqual([...app.agents.info(scope).environment!.skills].sort(), allSkillNames);
    assert.equal(blockedConnections, 0);
    const empty = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: w.id }) as Session;
    const emptyScope = { workspaceId: w.id, sessionId: empty.id }, emptyCatalog = await app.agents.capabilities.get(emptyScope);
    await app.agents.capabilities.command({ op: "capabilities.save", requestId: randomUUID(), ...emptyScope,
      params: { revision: 0, catalogRevision: emptyCatalog.revision, skills: [], mcp: [] } });
    const before = connections, discoveryBeforeEmpty = discoveryCount();
    await app.agents.command({ op: "prompt", requestId: randomUUID(), ...emptyScope, params: { text: "No optional capabilities" } });
    await wait(() => !running(app!.agents.info(emptyScope).run));
    assert.equal(app.agents.info(emptyScope).run?.status, "completed");
    assert.deepEqual([...app.agents.info(emptyScope).environment!.skills].sort(), allSkillNames);
    assert.equal(connections, before); assert.equal(blockedConnections, 0);
    assert.ok(discoveryCount() > discoveryBeforeEmpty, "empty selection also rejects actual extension discovery");
    assertRequestSelection(requests.at(-1), false);
    const discoveryBeforeRestart = discoveryCount();
    await app.close(); app = await startServer({ root, port: 0 });
    assert.equal(app.agents.capabilities.state(scope).locked, true);
    assert.deepEqual(app.agents.capabilities.state(scope).selection, { skills: selectedIds, mcp: ["chosen"] });
    await app.agents.command({ op: "prompt", requestId: randomUUID(), ...scope, params: { text: "Continue after restart" } });
    await wait(() => !running(app!.agents.info(scope).run));
    assert.equal(app.agents.info(scope).run?.status, "completed");
    assert.deepEqual([...app.agents.info(scope).environment!.skills].sort(), allSkillNames);
    assertRequestSelection(requests.at(-1), true);
    const connectionsBeforeEmptyRestart = connections;
    assert.deepEqual(app.agents.capabilities.state(emptyScope).selection, { skills: [], mcp: [] });
    await app.agents.command({ op: "prompt", requestId: randomUUID(), ...emptyScope, params: { text: "Remain empty after restart" } });
    await wait(() => !running(app!.agents.info(emptyScope).run));
    assert.equal(app.agents.info(emptyScope).run?.status, "completed");
    assert.deepEqual([...app.agents.info(emptyScope).environment!.skills].sort(), allSkillNames);
    assertRequestSelection(requests.at(-1), false);
    assert.equal(connections, connectionsBeforeEmptyRestart);
    assert.ok(discoveryCount() >= discoveryBeforeRestart + 2, "both restarted workers handled extension resource discovery");
    assert.equal(blockedConnections, 0);
    for (const params of [
      { text: "Use manual skill", skills: [{ id: manualSkill.id, name: manualSkill.name, description: manualSkill.description }] },
      { text: "/skill:unused-skill Use the explicit command" },
    ]) {
      const beforeRequests = requests.length;
      await app.agents.command({ op: "prompt", requestId: randomUUID(), ...emptyScope, params });
      await wait(() => !running(app!.agents.info(emptyScope).run));
      assert.equal(app.agents.info(emptyScope).run?.status, "completed");
      assert.ok(requests.length > beforeRequests);
      const request = requests.at(-1);
      assert.match(JSON.stringify(request.messages.filter((message: any) => message.role === "user").at(-1)), /MANUAL_ONLY_BODY/);
      assert.ok(!JSON.stringify(request.messages.filter((message: any) => message.role === "system")).includes("unused-skill marker"));
    }
    assert.equal(readFileSync(manualSkill.source, "utf8"), manualSource, "runtime selection never edits shared frontmatter");
  } finally {
    await app?.close(); fixture.closeAllConnections(); await new Promise<void>(resolve => fixture.close(() => resolve()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
