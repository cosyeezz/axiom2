import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { createAgentSession, DefaultPackageManager, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { previewEnvironment, runtimeEnvironment } from "../src/server/session-environment.js";
import { environmentResourceOptions } from "../src/server/environment-resources.js";
import { installAxiomPrompt } from "../src/server/axiom-prompt.js";
import { memoryInstruction } from "../src/shared/memory.js";
import { createInstalledResourceLoader } from "../src/server/installed-resource-loader.js";
import { discoverCapabilities, capabilityRuntime } from "../src/server/capability-resources.js";
import { taskTools } from "../src/server/task-tools.js";
import { memoryQueryTool } from "../src/server/memory-tool.js";
import { ensureTopicSnapshot } from "../src/server/memory-topics.js";
import { Agents } from "../src/server/agents.js";
import { Store } from "../src/server/storage.js";
import { ModelService } from "../src/server/model-service.js";
import type { SessionEnvironment } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-environment-unit-")), cwd = join(root, "project"), pi = join(root, "pi");
  mkdirSync(pi); mkdirSync(join(cwd, ".pi", "skills", "guide"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "skills", "guide", "SKILL.md"), "---\nname: guide\ndescription: A fixture skill\n---\nSkill body is loaded on demand.");
  writeFileSync(join(cwd, "AGENTS.md"), "LOCAL_PROJECT_CONTEXT");
  writeFileSync(join(cwd, ".pi", "APPEND_SYSTEM.md"), "LOCAL_APPEND_CONTEXT");
  const memoryTopics = { version: 2 as const, workspaceId: "fixture", text: '<记忆关键词目录>\nTest keyword\n</记忆关键词目录>' };
  return { root, cwd, pi, memoryTopics, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("memory instruction is replaced as a whole without altering other appended policies", () => {
  const base = ["BASE_APPEND_POLICY"], input = { root: "/tmp/fixture", cwd: "/tmp/fixture/project" };
  const append = (extra: { memoryPath?: string; task?: unknown }) => environmentResourceOptions({ ...input, ...extra }, () => ({}), "CHILD_POLICY").appendSystemPromptOverride!(base);
  const withoutMemory = append({}), path = "/tmp/fixture/memory/MEMORY.md";
  const withMemory = append({ memoryPath: path }), instruction = memoryInstruction(path);
  assert.equal(withMemory.filter(text => text === instruction).length, 1);
  assert.deepEqual(withMemory.filter(text => text !== instruction), withoutMemory);
  assert.equal(withMemory[0], base[0]);
  const linkInstruction = "When referencing files, use Markdown links: [filename](path)";
  assert.ok(withMemory.includes(linkInstruction));
  assert.doesNotMatch(withMemory.join("\n"), /When referencing local files/);
  assert.ok(withMemory.some(text => text.startsWith("Split work suitable for delegation")));
  assert.deepEqual(append({ task: {}, memoryPath: path }), [...base, linkInstruction, "CHILD_POLICY"]);
  assert.doesNotMatch(withMemory.join("\n"), /\p{Script=Han}/u);
});

test("session-free preview uses native prompt generation and identical execution resource rules", async () => {
  const f = fixture();
  const noExecute = async (): Promise<never> => { throw Error("must not execute tools"); };
  try {
    for (const custom of [false, true]) {
      if (custom) {
        writeFileSync(join(f.cwd, ".pi", "SYSTEM.md"), "CUSTOM_SYSTEM_PROMPT");
        writeFileSync(join(f.pi, "settings.json"), JSON.stringify({ defaultTools: ["read", "+grep", "-bash"] }));
      }
      const catalog = await discoverCapabilities(f.root, f.cwd, f.pi);
      const input = { ...f, memoryPath: join(f.root, "memory", "fixture", "MEMORY.md"),
        capabilities: capabilityRuntime(catalog, { skills: custom ? [] : ["guide"], mcp: [] }) };
      const preview = await previewEnvironment(input);
      assert.equal(existsSync(join(f.pi, "sessions")), false, "preview never creates transcript storage");
      assert.equal(preview.source, "preview");
      assert.match(preview.systemPrompt!, /LOCAL_APPEND_CONTEXT/);
      assert.match(preview.systemPrompt!, /LOCAL_PROJECT_CONTEXT/);
      assert.ok(preview.systemPrompt!.includes(memoryInstruction(input.memoryPath)), "preview includes the entire current memory instruction");
      assert.match(preview.systemPrompt!, /When referencing files, use Markdown links: \[filename\]\(path\)/);
      assert.doesNotMatch(preview.systemPrompt!, /When referencing local files/);
      assert.doesNotMatch(preview.systemPrompt!, /\p{Script=Han}/u, "host instructions are English in an English-only user fixture");
      assert.doesNotMatch(JSON.stringify(preview.toolDefinitions), /\p{Script=Han}/u, "model-visible tool descriptions and schemas are English");
      assert.equal(preview.skillDetails?.find(skill => skill.name === "guide")?.automatic, !custom);
      assert.equal(preview.memory?.topics, f.memoryTopics.text);
      const settingsManager = SettingsManager.create(f.cwd, f.pi, { projectTrusted: true });
      settingsManager.applyOverrides({ cacheWarming: "off" });
      const loader = createInstalledResourceLoader({ cwd: f.cwd, agentDir: f.pi, settingsManager,
        ...environmentResourceOptions(input, () => ({})), noExtensions: true, noPromptTemplates: true, noThemes: true },
        () => assert.fail("fixture resources must already be installed"));
      await loader.reload();
      const { session } = await createAgentSession({ cwd: f.cwd, agentDir: f.pi, settingsManager, resourceLoader: loader,
        sessionManager: SessionManager.inMemory(f.cwd), customTools: [...taskTools(noExecute), memoryQueryTool(noExecute)],
        ...(process.platform === "win32" && !settingsManager.getSettings().defaultTools ? { tools: ["-bash", "+powershell"] } : {}) });
      try {
        installAxiomPrompt(session);
        session.setActiveToolsByName([...new Set([...session.getActiveToolNames(), ...taskTools(noExecute).map(tool => tool.name), "memory_query", "memory_detail"])]);
        ensureTopicSnapshot(session.sessionManager, f.memoryTopics);
        const actual = runtimeEnvironment(session, input);
        assert.equal(preview.systemPrompt, actual.systemPrompt, "preview and SDK runtime prompts are byte-identical for static resources");
        assert.deepEqual(preview.tools, actual.tools);
        const ordered = (value: SessionEnvironment) => value.toolDefinitions!.map(tool => JSON.parse(JSON.stringify(tool))).sort((a, b) => a.name.localeCompare(b.name));
        assert.deepEqual(ordered(preview), ordered(actual), "schema and descriptions match real SDK tools");
        assert.deepEqual(preview.skillDetails, actual.skillDetails);
        assert.equal(actual.memory?.topics, f.memoryTopics.text);
        assert.equal(session.messages.length, 0, "no model request or user message used for comparison");
      } finally { session.dispose(); }
    }
  } finally { f.cleanup(); }
});

for (const offline of [false, true]) test(`preloading never launches extension/MCP or installs missing packages and omits credentials (offline=${offline})`, async t => {
  const f = fixture(), previousOffline = process.env.PI_OFFLINE;
  // Pi 1.1.0 skips onMissing entirely in offline mode. Test both paths explicitly,
  // without ever allowing the online warning path to install or access the network.
  if (offline) process.env.PI_OFFLINE = '1'; else delete process.env.PI_OFFLINE;
  const network = t.mock.method(globalThis, 'fetch', async () => { throw Error('Fixture forbids network'); });
  // Version-bound safety guard: resolve() calls this private installation boundary directly.
  const installation = t.mock.method(DefaultPackageManager.prototype as unknown as { installParsedSource(): Promise<void> },
    'installParsedSource', async () => { throw Error('Fixture forbids installation'); });
  try {
    const marker = join(f.root, "extension-ran");
    mkdirSync(join(f.cwd, ".pi", "extensions"));
    writeFileSync(join(f.cwd, ".pi", "extensions", "fixture.ts"), `import { writeFileSync } from 'node:fs'; export default () => writeFileSync(${JSON.stringify(marker)}, 'unsafe');`);
    writeFileSync(join(f.pi, "mcp.json"), JSON.stringify({ mcpServers: {
      fixture: { command: "must-not-launch", args: ["secret-argument"], env: { TOKEN: "secret-env" }, exposure: "direct", description: "Fixture server" },
      remote: { url: "https://example.invalid/mcp?token=secret-url", headers: { Authorization: "secret-header" }, enabled: false },
    } }));
    writeFileSync(join(f.pi, "settings.json"), JSON.stringify({ packages: ["npm:axiom-environment-must-never-install@0.0.0"] }));
    const catalog = await discoverCapabilities(f.root, f.cwd, f.pi);
    const preview = await previewEnvironment({ ...f, capabilities: capabilityRuntime(catalog, { skills: ["guide"], mcp: ["fixture"] }) });
    assert.equal(existsSync(marker), false);
    assert.equal(existsSync(join(f.pi, "sessions")), false);
    assert.equal(preview.mcp?.length, 1);
    assert.equal(preview.mcp?.[0].name, "fixture");
    for (const secret of ["secret-argument", "secret-env", "secret-url", "secret-header", "must-not-launch"])
      assert.equal(JSON.stringify(preview).includes(secret), false);
    assert.equal(preview.extensions, 0);
    assert.ok(preview.warnings.some(text => text.includes("未启动 session")));
    if (!offline) assert.ok(catalog.warnings.some(text => text.includes("尚未安装")));
    assert.equal(network.mock.callCount(), 0, 'discovery and preview never attempt network requests');
    assert.equal(installation.mock.callCount(), 0, 'discovery and preview never attempt package installation');
  } finally {
    if (previousOffline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = previousOffline;
    network.mock.restore(); installation.mock.restore(); f.cleanup();
  }
});

test("agent.environment preserves empty-session semantics, scope ownership and existing snapshots", async () => {
  const f = fixture(), previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = f.pi;
  const store = new Store(f.root), agents = new Agents(store, new ModelService(f.root), () => {});
  try {
    const workspace = store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: f.cwd, authorized: true } }) as Workspace;
    const session = store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    const read = () => agents.command({ requestId: crypto.randomUUID(), op: "agent.environment", ...scope });
    const preview = await read() as SessionEnvironment;
    assert.equal(preview.source, "preview");
    assert.equal(preview.memory?.topics, agents.memories.topicSnapshot(workspace.id).text);
    assert.equal(agents.info(scope).environment, null, "preview is not persisted as execution evidence");
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM runs").get()?.n, 0);
    assert.equal(store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(session.id)?.file ?? null, null);
    assert.equal(agents.capabilities.state(scope).locked, false);
    assert.equal(agents.pool.stats().created, 0, "preview does not admit a worker");
    const reused = store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id, params: { reuseEmpty: true } }) as Session;
    assert.equal(reused.id, session.id);
    await assert.rejects(agents.command({ requestId: crypto.randomUUID(), op: "agent.environment", ...scope, workspaceId: "wrong" }));
    await assert.rejects(agents.command({ requestId: crypto.randomUUID(), op: "agent.environment", ...scope, params: { start: true } }), { code: "INVALID_INPUT" });
    const prepare = agents.capabilities.prepare.bind(agents.capabilities);
    agents.capabilities.prepare = async (...args) => {
      const plan = await prepare(...args);
      store.db.prepare("UPDATE session_capabilities SET revision=revision+1 WHERE sessionId=?").run(session.id);
      return plan;
    };
    await assert.rejects(read(), { code: "REVISION_CONFLICT" }, "a pending preview rejects a superseded selection");
    agents.capabilities.prepare = prepare;
    const actual = { ...preview, source: "runtime", systemPrompt: "ACTUAL_PERSISTED_PROMPT" };
    agents.capabilities.prepare = async (...args) => {
      const plan = await prepare(...args);
      // A run publishes its snapshot while the display request is in flight.
      store.db.prepare("INSERT INTO agent_sessions(sessionId,environment) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET environment=excluded.environment")
        .run(session.id, JSON.stringify(actual));
      return plan;
    };
    assert.deepEqual(await read(), JSON.parse(JSON.stringify(actual)), "runtime wins over an in-flight preview");
    agents.capabilities.prepare = prepare;
    assert.deepEqual(await read(), JSON.parse(JSON.stringify(actual)), "a read never substitutes current config for historical execution");
  } finally {
    await agents.close(); store.close();
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    f.cleanup();
  }
});
