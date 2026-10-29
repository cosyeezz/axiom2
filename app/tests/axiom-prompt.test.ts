import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createAgentSession, DefaultResourceLoader, loadSkills, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { tmpdir } from "./temporary.js";
import { axiomSystemPrompt, neutralSystemPrompt, buildAxiomSystemPrompt, installAxiomPrompt, piDevelopmentSkillPath } from "../src/server/axiom-prompt.js";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { getCurrentSystemMessage, getSystemMessageText, type SystemMessage } from "@earendil-works/pi-ai";
import type { BuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { capabilityRuntime, discoverCapabilities } from "../src/server/capability-resources.js";
import { environmentResourceOptions as hostResourceOptions } from "../src/server/environment-resources.js";
import { previewEnvironment } from "../src/server/session-environment.js";
import { prepareSkillInput } from "../src/server/skill-input.js";

const nativePrompt = await import(new URL("./core/system-prompt.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href) as {
  buildSystemPrompt(input: BuildSystemPromptOptions): string;
  buildSystemPromptSections(input: BuildSystemPromptOptions): Record<string, string>;
};

// Agent directories do not disable Pi's shared user-home skill discovery.
// These fixtures exercise shipped/selected host resources, not external skills.
const environmentResourceOptions = (...args: Parameters<typeof hostResourceOptions>) => ({ ...hostResourceOptions(...args), noSkills: true });

test("native English tool snippets and rules survive byte-for-byte, including hidden and extension tools", () => {
  for (const selectedTools of [["read", "bash", "edit", "write"], ["read", "grep", "extension"]]) {
    for (const hiddenTools of [[], ["read"]]) {
      const options: BuildSystemPromptOptions = { cwd: "/project", selectedTools, hiddenTools,
        toolSnippets: { read: "Read file contents", bash: "Execute bash commands", edit: "Edit a file",
          write: "Write a file", grep: "Search files", extension: "EXTENSION_SNIPPET" },
        toolGuidelines: { read: ["READ_RULE"], extension: ["EXTENSION_RULE"] }, promptGuidelines: ["EXTRA_RULE"],
        sections: { extra: "EXTRA_SECTION" }, appendSystemPrompt: "APPEND" };
      const native = nativePrompt.buildSystemPromptSections(options);
      const actual = buildAxiomSystemPrompt(options);
      for (const [name, value] of Object.entries(native)) {
        if (name !== "preamble" && name !== "docs") assert.ok(actual.includes(value), name);
      }
      assert.ok(actual.startsWith(axiomSystemPrompt));
      assert.doesNotMatch(actual, /<docs>/);
      if (hiddenTools.length) assert.doesNotMatch(actual, /Read file contents|READ_RULE/);
    }
  }
  const options = { cwd: "/project", sections: { docs: "EXTENSION_DOCS" } };
  assert.match(buildAxiomSystemPrompt(options), /<docs>\nEXTENSION_DOCS\n<\/docs>/);
  for (const customPrompt of ["CUSTOM_SYSTEM", nativePrompt.buildSystemPromptSections(options).preamble]) {
    assert.equal(buildAxiomSystemPrompt({ ...options, customPrompt }), nativePrompt.buildSystemPrompt({ ...options, customPrompt }));
  }
  assert.equal(buildAxiomSystemPrompt({ ...options, forceSystemPrompt: "OPAQUE_EXTENSION" }), "OPAQUE_EXTENSION");
  const defaults = { cwd: "/project" };
  assert.equal(buildAxiomSystemPrompt({ ...defaults, forceSystemPrompt: nativePrompt.buildSystemPrompt(defaults) + "\nEXTENSION_SUFFIX" }),
    buildAxiomSystemPrompt(defaults) + "\nEXTENSION_SUFFIX");
});

test("Kiro neutralizes only generated identity and the shipped skill description, preserving caller content", () => {
  const f = fixture();
  try {
    const { skills } = loadSkills({ cwd: f.cwd, agentDir: f.agentDir, skillPaths: [piDevelopmentSkillPath], includeDefaults: false });
    const custom = { ...skills[0], name: "user-skill", filePath: join(f.cwd, "USER.md"), description: "User Axiom skill must remain" };
    const options: BuildSystemPromptOptions = { cwd: f.cwd, skills: [...skills, custom],
      appendSystemPrompt: "APPENDED Axiom policy", sections: { extra: "User Axiom section" } };
    const before = structuredClone(options), actual = buildAxiomSystemPrompt(options, "kiro-chat");
    assert.ok(actual.startsWith(neutralSystemPrompt));
    assert.doesNotMatch(actual, /Axiom is built on Pi|Axiom's underlying/);
    for (const text of [custom.description, options.appendSystemPrompt!, "User Axiom section"]) assert.ok(actual.includes(text));
    assert.ok(buildAxiomSystemPrompt(options).startsWith(axiomSystemPrompt));
    assert.match(buildAxiomSystemPrompt(options), /Axiom is built on Pi/);
    for (const customPrompt of [axiomSystemPrompt, nativePrompt.buildSystemPromptSections(options).preamble]) {
      const input = { ...options, customPrompt };
      assert.ok(buildAxiomSystemPrompt(input, "kiro-chat").startsWith(customPrompt));
    }
    const opaque = "OPAQUE Axiom extension prompt";
    assert.equal(buildAxiomSystemPrompt({ ...options, forceSystemPrompt: opaque }, "kiro-chat"), opaque);
    const forced = nativePrompt.buildSystemPrompt(options) + "\nEXTENSION Axiom suffix";
    assert.equal(buildAxiomSystemPrompt({ ...options, forceSystemPrompt: forced }, "kiro-chat"), actual + "\nEXTENSION Axiom suffix");
    assert.deepEqual(options, before);
  } finally { f.cleanup(); }
});

test("runtime Kiro identity follows model switches and reload without rewriting caller prompts or history", async () => {
  const f = fixture(), settingsManager = SettingsManager.inMemory({ cacheWarming: "off" });
  const loader = new DefaultResourceLoader({ cwd: f.cwd, agentDir: f.agentDir, settingsManager,
    ...environmentResourceOptions(f, () => ({})), noExtensions: true });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: f.cwd, agentDir: f.agentDir, settingsManager, resourceLoader: loader,
    sessionManager: SessionManager.inMemory(f.cwd) });
  try {
    const bridge = session as unknown as { _baseSystemPromptOptions: BuildSystemPromptOptions;
      _preparePromptAndToolLoadout(options: BuildSystemPromptOptions, messages: AgentMessage[]): SystemMessage | undefined };
    const setApi = (api: "kiro-chat" | "openai-completions") => (session.agent.state.model = {
      provider: api === "kiro-chat" ? "kiro" : "fixture", id: "fixture", name: "Fixture", api,
      baseUrl: "http://127.0.0.1:1", reasoning: false, input: ["text"], contextWindow: 32000, maxTokens: 1024,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
    installAxiomPrompt(session);
    const messages: AgentMessage[] = [{ role: "system", content: "", timestamp: 0,
      sections: { preamble: axiomSystemPrompt, extra: "Historical Axiom policy" } }];
    const history = JSON.stringify(messages[0]);
    const prepare = () => {
      const update = bridge._preparePromptAndToolLoadout(bridge._baseSystemPromptOptions, messages);
      if (update) messages.push(update);
      return update;
    };
    setApi("kiro-chat"); prepare();
    assert.equal(getCurrentSystemMessage(messages)?.sections?.preamble, neutralSystemPrompt);
    assert.ok(session.systemPrompt.startsWith(neutralSystemPrompt));
    assert.doesNotMatch(getCurrentSystemMessage(messages)?.sections?.skills ?? "", /Axiom is built on Pi|Axiom's underlying/);
    assert.equal(prepare(), undefined);
    setApi("openai-completions"); prepare();
    assert.equal(getCurrentSystemMessage(messages)?.sections?.preamble, axiomSystemPrompt);
    const options = bridge._baseSystemPromptOptions;
    options.forceSystemPrompt = nativePrompt.buildSystemPrompt(options) + "\nFORCED Axiom suffix";
    prepare();
    assert.ok(options.forceSystemPrompt.startsWith(axiomSystemPrompt));
    setApi("kiro-chat");
    assert.ok(session.systemPrompt.startsWith(neutralSystemPrompt), "getter uses the original generated force prompt");
    prepare();
    assert.ok(options.forceSystemPrompt.startsWith(neutralSystemPrompt));
    assert.ok(options.forceSystemPrompt.endsWith("FORCED Axiom suffix"));
    setApi("openai-completions"); prepare();
    assert.ok(options.forceSystemPrompt.startsWith(axiomSystemPrompt));
    options.forceSystemPrompt = "OPAQUE Axiom extension prompt";
    setApi("kiro-chat"); prepare();
    assert.equal(session.systemPrompt, options.forceSystemPrompt);
    delete options.forceSystemPrompt;
    writeFileSync(join(f.cwd, ".pi", "SYSTEM.md"), axiomSystemPrompt);
    await session.reload(); prepare();
    assert.ok(session.systemPrompt.startsWith(axiomSystemPrompt), "explicit user identity is not a generated identity");
    writeFileSync(join(f.cwd, ".pi", "SYSTEM.md"), "");
    await session.reload(); prepare();
    assert.ok(session.systemPrompt.startsWith(neutralSystemPrompt));
    assert.equal(JSON.stringify(messages[0]), history);
  } finally { session.dispose(); f.cleanup(); }
});

test("runtime prompt patches follow native loadouts, migrate old docs once, and survive reload", async () => {
  const f = fixture();
  let hideRead = false;
  const settingsManager = SettingsManager.inMemory({ cacheWarming: "off" });
  const loader = new DefaultResourceLoader({ cwd: f.cwd, agentDir: f.agentDir, settingsManager,
    ...environmentResourceOptions(f, () => ({})), noExtensions: true });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: f.cwd, agentDir: f.agentDir, settingsManager, resourceLoader: loader,
    sessionManager: SessionManager.inMemory(f.cwd), customTools: [{ name: "gateway", label: "Gateway", description: "Gateway",
      promptSnippet: "Gateway snippet", parameters: Type.Object({}),
      prepareLoadout: () => ({ hiddenDeclarations: hideRead ? ["read"] : [] }),
      execute: async () => ({ content: [{ type: "text", text: "unused" }], details: {} }) }] });
  try {
    const bridge = session as unknown as {
      _baseSystemPromptOptions: BuildSystemPromptOptions;
      _preparePromptAndToolLoadout(options: BuildSystemPromptOptions, messages: AgentMessage[]): SystemMessage | undefined;
    };
    const initial = nativePrompt.buildSystemPromptSections(bridge._baseSystemPromptOptions);
    installAxiomPrompt(session);
    installAxiomPrompt(session);
    const messages: AgentMessage[] = [{ role: "system", content: "", sections: initial, timestamp: 0 }];
    const prepare = () => bridge._preparePromptAndToolLoadout(bridge._baseSystemPromptOptions, messages);
    const migration = prepare()!;
    assert.deepEqual(migration.sections, { preamble: axiomSystemPrompt, docs: null });
    messages.push(migration);
    assert.equal(prepare(), undefined, "no redundant identity/docs update on the next request");
    hideRead = true;
    const hidden = prepare()!;
    messages.push(hidden);
    const nativeHidden = nativePrompt.buildSystemPromptSections(bridge._baseSystemPromptOptions);
    assert.equal(hidden.sections?.tools, nativeHidden.tools);
    assert.equal(hidden.sections?.rules, nativeHidden.rules);
    assert.doesNotMatch(getSystemMessageText(getCurrentSystemMessage(messages)!), /- read:/);
    assert.equal(session.systemPrompt, getSystemMessageText(getCurrentSystemMessage(messages)!));
    assert.equal(prepare(), undefined);
    hideRead = false;
    session.setActiveToolsByName(["read", "gateway"]);
    const changed = prepare()!;
    messages.push(changed);
    assert.match(changed.sections?.tools ?? "", /- read:|Gateway snippet/);
    assert.doesNotMatch(changed.sections?.tools ?? "", /- bash:/);
    assert.equal(prepare(), undefined);
    const options = bridge._baseSystemPromptOptions;
    options.forceSystemPrompt = nativePrompt.buildSystemPrompt(options) + "\nFORCED_SUFFIX";
    prepare();
    assert.ok(options.forceSystemPrompt.startsWith(axiomSystemPrompt));
    assert.doesNotMatch(options.forceSystemPrompt, /<docs>/);
    assert.ok(options.forceSystemPrompt.endsWith("FORCED_SUFFIX"));
    options.forceSystemPrompt = "OPAQUE_EXTENSION";
    prepare();
    assert.equal(session.systemPrompt, "OPAQUE_EXTENSION");
    writeFileSync(join(f.cwd, ".pi", "SYSTEM.md"), "RELOADED_CUSTOM");
    await session.reload();
    assert.ok(session.systemPrompt.startsWith("RELOADED_CUSTOM"));
    const customReload = prepare()!;
    assert.equal(customReload.sections?.preamble, "RELOADED_CUSTOM");
    messages.push(customReload);
    writeFileSync(join(f.cwd, ".pi", "SYSTEM.md"), "");
    await session.reload();
    assert.ok(session.systemPrompt.startsWith(axiomSystemPrompt));
    const reloaded = prepare()!;
    messages.push(reloaded);
    // Pi patches retain insertion order: restored tools/rules follow surviving
    // sections after switching from SYSTEM.md. Compare section values, not order.
    const expected = nativePrompt.buildSystemPromptSections(bridge._baseSystemPromptOptions);
    expected.preamble = axiomSystemPrompt;
    delete expected.docs;
    assert.deepEqual(getCurrentSystemMessage(messages)?.sections, expected);
    for (const section of Object.values(expected)) assert.ok(session.systemPrompt.includes(section));
    assert.doesNotMatch(session.systemPrompt, /<docs>/);
  } finally { session.dispose(); f.cleanup(); }
});

test("English host sections replace Chinese history once without rewriting prior messages", async () => {
  const f = fixture(), memoryPath = join(f.root, "memory", "MEMORY.md");
  const settingsManager = SettingsManager.inMemory({ cacheWarming: "off" });
  const loader = new DefaultResourceLoader({ cwd: f.cwd, agentDir: f.agentDir, settingsManager,
    ...environmentResourceOptions({ ...f, memoryPath }, () => ({})), noExtensions: true });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: f.cwd, agentDir: f.agentDir, settingsManager, resourceLoader: loader,
    sessionManager: SessionManager.inMemory(f.cwd) });
  try {
    const bridge = session as unknown as {
      _baseSystemPromptOptions: BuildSystemPromptOptions;
      _preparePromptAndToolLoadout(options: BuildSystemPromptOptions, messages: AgentMessage[]): SystemMessage | undefined;
    };
    const expected = nativePrompt.buildSystemPromptSections(bridge._baseSystemPromptOptions);
    expected.preamble = axiomSystemPrompt;
    delete expected.docs;
    const oldSections = { ...expected, addendum: `本会话记忆文件：${memoryPath}\n\n# 任务管理与记忆维护`,
      skills: expected.skills.replace("Axiom is built on Pi.", "Axiom 基于 Pi 构建。") };
    assert.notEqual(oldSections.skills, expected.skills);
    const messages: AgentMessage[] = [{ role: "system", content: "", sections: oldSections, timestamp: 0 }];
    const history = JSON.stringify(messages[0]);
    installAxiomPrompt(session);
    const prepare = () => bridge._preparePromptAndToolLoadout(bridge._baseSystemPromptOptions, messages);
    const changed = prepare()!;
    assert.deepEqual(changed.sections, { addendum: expected.addendum, skills: expected.skills });
    messages.push(changed);
    assert.equal(JSON.stringify(messages[0]), history);
    assert.deepEqual(getCurrentSystemMessage(messages)?.sections, expected);
    assert.doesNotMatch(getSystemMessageText(getCurrentSystemMessage(messages)!), /\p{Script=Han}/u);
    assert.equal(prepare(), undefined, "translated sections must not produce another patch");
    await session.reload();
    assert.equal(prepare(), undefined, "reloading unchanged resources must preserve the same section version");
  } finally { session.dispose(); f.cleanup(); }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-pi-prompt-")), cwd = join(root, "project"), agentDir = join(root, "pi");
  mkdirSync(join(cwd, ".pi"), { recursive: true }); mkdirSync(agentDir);
  return { root, cwd, agentDir, memoryTopics: { version: 2 as const, workspaceId: "fixture", text: "" },
    cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("startup advertises Pi development metadata, reads its body only on explicit use, and respects selection", async () => {
  const f = fixture();
  try {
    const catalog = await discoverCapabilities(f.root, f.cwd, f.agentDir);
    const skill = catalog.skills.find(item => item.name === "pi-development")!;
    assert.ok(skill?.defaultSelected);
    assert.equal(skill.source, piDevelopmentSkillPath);
    assert.match(skill.description, /Axiom is built on Pi/);
    assert.match(readFileSync(skill.source, "utf8").split("---")[2], /Axiom 基于 Pi 构建/);
    const input = { ...f, capabilities: capabilityRuntime(catalog, { skills: [skill.id], mcp: [] }) };
    const preview = await previewEnvironment(input);
    assert.ok(preview.systemPrompt!.startsWith(axiomSystemPrompt));
    assert.match(preview.systemPrompt!, /<name>pi-development<\/name>/);
    assert.doesNotMatch(preview.systemPrompt!, /<docs>|Pi documentation|docs\/sdk\.md|documentation-paths\.mjs/);
    assert.equal(existsSync(join(f.agentDir, "sessions")), false);

    const settingsManager = SettingsManager.inMemory({ cacheWarming: "off" });
    const loader = new DefaultResourceLoader({ cwd: f.cwd, agentDir: f.agentDir, settingsManager,
      ...environmentResourceOptions(input, () => ({})), noExtensions: true });
    await loader.reload();
    const { session } = await createAgentSession({ cwd: f.cwd, agentDir: f.agentDir, settingsManager, resourceLoader: loader,
      sessionManager: SessionManager.inMemory(f.cwd) });
    try {
      installAxiomPrompt(session);
      assert.ok(session.systemPrompt.startsWith(axiomSystemPrompt));
      assert.doesNotMatch(session.systemPrompt, /<docs>|docs\/sdk\.md/);
      assert.equal(session.resourceLoader.getSkills().skills.find(item => item.name === skill.name)?.filePath, skill.source);
      const references = [{ id: skill.id, name: skill.name, description: skill.description }];
      assert.match(prepareSkillInput("inspect SDK", references, session).prompt, /docs\/sdk\.md/);
      input.capabilities.selection.skills = [];
      await loader.reload();
      assert.equal(loader.getSkills().skills.find(item => item.name === skill.name)?.disableModelInvocation, true);
      assert.match(prepareSkillInput("inspect SDK", references, session).prompt, /docs\/sdk\.md/);
    } finally { session.dispose(); }

    const disabled = await previewEnvironment(input);
    assert.doesNotMatch(disabled.systemPrompt!, /<name>pi-development<\/name>/);
    assert.equal(disabled.skillDetails?.find(item => item.name === skill.name)?.automatic, false);
  } finally { f.cleanup(); }
});

test("custom SYSTEM.md keeps precedence, while legacy and child resources include the development skill", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.cwd, ".pi", "SYSTEM.md"), "PROJECT_SYSTEM 用户系统指令");
    writeFileSync(join(f.cwd, ".pi", "APPEND_SYSTEM.md"), "PROJECT_APPEND 用户追加规则");
    writeFileSync(join(f.cwd, "AGENTS.md"), "PROJECT_CONTEXT 用户项目规则");
    const preview = await previewEnvironment(f);
    assert.ok(preview.systemPrompt!.startsWith("PROJECT_SYSTEM 用户系统指令"));
    assert.doesNotMatch(preview.systemPrompt!, /You are an AI assistant in Axiom|<docs>/);
    assert.match(preview.systemPrompt!, /PROJECT_APPEND 用户追加规则/);
    assert.match(preview.systemPrompt!, /PROJECT_CONTEXT 用户项目规则/);
    assert.match(preview.systemPrompt!, /<name>pi-development<\/name>/);
    const loader = new DefaultResourceLoader({ cwd: f.cwd, agentDir: f.agentDir,
      settingsManager: SettingsManager.inMemory(), noExtensions: true,
      ...environmentResourceOptions({ ...f, task: {} }, () => ({}), "CHILD_POLICY") });
    await loader.reload();
    assert.ok(loader.getSkills().skills.some(item => item.name === "pi-development"));
    assert.ok(loader.getAppendSystemPrompt().includes("CHILD_POLICY"));
    assert.equal(loader.getSystemPrompt(), "PROJECT_SYSTEM 用户系统指令");
    writeFileSync(join(f.cwd, ".pi", "SYSTEM.md"), "");
    assert.ok((await previewEnvironment(f)).systemPrompt!.startsWith(axiomSystemPrompt), "an empty SYSTEM.md uses the host default");
  } finally { f.cleanup(); }
});

test("development skill resolves this installation's docs outside the application working directory", () => {
  const f = fixture();
  try {
    const script = join(dirname(piDevelopmentSkillPath), "scripts", "documentation-paths.mjs");
    const paths = JSON.parse(execFileSync(process.execPath, [script], { cwd: f.cwd, encoding: "utf8" }));
    assert.equal(paths.version, JSON.parse(readFileSync(join(paths.packageRoot, "package.json"), "utf8")).version);
    for (const path of [paths.readme, join(paths.docs, "sdk.md"), join(paths.examples, "sdk", "03-custom-prompt.ts")])
      assert.ok(existsSync(path), path);
  } finally { f.cleanup(); }
});
