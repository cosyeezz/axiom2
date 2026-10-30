import { join } from "node:path";
import {
  DefaultResourceLoader, SettingsManager,
  createReadToolDefinition, createBashToolDefinition, createPowerShellToolDefinition,
  createEditToolDefinition, createWriteToolDefinition, createGrepToolDefinition,
  createFindToolDefinition, createLsToolDefinition,
  type AgentSession, type ResourceLoader, type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { SessionEnvironment } from "../shared/agent.js";
import type { MemoryTopicSnapshot } from "../shared/memory-tree.js";
import type { CapabilityRuntime } from "./capability-resources.js";
import { environmentResourceOptions, type EnvironmentResourceInput } from "./environment-resources.js";
import { openCliResources } from "./integrations/opencli-resources.js";
import { reaResources } from "./integrations/rea-resources.js";
import { taskTools } from "./task-tools.js";
import { memoryQueryTool } from "./memory-tool.js";
import { resourceWarnings } from "./reload-resources.js";
import { topicSnapshot } from "./memory-topics.js";
import { sessionRetrySettings } from "./session-retry-policy.js";

import { buildAxiomSystemPrompt } from "./axiom-prompt.js";

function resources(loader: ResourceLoader, capabilities?: CapabilityRuntime) {
  const skills = loader.getSkills().skills;
  return {
    skills: skills.map(skill => skill.name),
    skillDetails: skills.map(skill => ({ name: skill.name, description: skill.description,
      path: skill.filePath, automatic: !skill.disableModelInvocation })),
    // Deliberately omit command, args, env, headers and URLs (may contain secrets).
    mcp: capabilities?.mcp.servers.map(server => ({ name: server.name,
      description: server.config.description ?? ("command" in server.config ? "本地 MCP 服务" : "远程 MCP 服务"),
      source: server.override ?? server.source })) ?? [],
  };
}
export function runtimeEnvironment(session: AgentSession, input: EnvironmentResourceInput & { memoryTopics?: MemoryTopicSnapshot }): SessionEnvironment {
  const names = session.getActiveToolNames();
  const topics = input.memoryTopics && (topicSnapshot(session.sessionManager, input.memoryTopics.workspaceId) ?? input.memoryTopics);
  return {
    source: "runtime", cwd: input.cwd, systemPrompt: session.systemPrompt, tools: names,
    toolDefinitions: session.getAllTools().filter(tool => names.includes(tool.name))
      .map(({ name, description, parameters }) => ({ name, description, parameters })),
    ...resources(session.resourceLoader, input.capabilities),
    ...(topics ? { memory: { topics: topics.text } } : {}),
    extensions: session.resourceLoader.getExtensions().extensions.length,
    retry: { ...sessionRetrySettings(session.settingsManager), provider: session.settingsManager.getProviderRetrySettings() },
    warnings: resourceWarnings(session, input.capabilities),
  };
}

/** Read resources only: no session, transcript, model, extension execution or MCP connection. */
export async function previewEnvironment(input: EnvironmentResourceInput & { memoryTopics: MemoryTopicSnapshot }): Promise<SessionEnvironment> {
  const agentDir = join(input.root, "pi");
  const projectSettings = SettingsManager.create(input.cwd, agentDir, { projectTrusted: true });
  // Package skills were resolved with install=skip by capability discovery. The
  // loader must not run its automatic package installer for a display request.
  const settings = SettingsManager.fromStorage({ withLock: (scope, read) => {
    const values = scope === "global" ? projectSettings.getGlobalSettings() : projectSettings.getProjectSettings();
    read(JSON.stringify({ ...values, packages: [], cacheWarming: "off" }));
  } }, { projectTrusted: true });
  const loader = new DefaultResourceLoader({ cwd: input.cwd, agentDir, settingsManager: settings,
    ...environmentResourceOptions(input, () => ({ opencli: openCliResources(input.root, input.cwd), rea: reaResources(input.root, input.cwd) })),
    noExtensions: true, noPromptTemplates: true, noThemes: true,
  });
  await loader.reload();
  const unavailable = async (): Promise<never> => { throw Error("环境预览不能执行工具。"); };
  const definitions: Pick<ToolDefinition, "name" | "description" | "parameters" | "promptSnippet" | "promptGuidelines">[] = [
    createReadToolDefinition(input.cwd), createBashToolDefinition(input.cwd), createPowerShellToolDefinition(input.cwd),
    createEditToolDefinition(input.cwd), createWriteToolDefinition(input.cwd), createGrepToolDefinition(input.cwd),
    createFindToolDefinition(input.cwd), createLsToolDefinition(input.cwd), ...taskTools(unavailable), memoryQueryTool(unavailable),
  ];
  const configured = settings.getDefaultTools();
  const defaults = configured ?? (process.platform === "win32"
    ? ["read", "edit", "write", "powershell"]
    : ["read", "bash", "edit", "write"]);
  const hostNames = [...taskTools(unavailable).map(tool => tool.name), "memory_query"];
  const names = [...new Set([...defaults, ...hostNames])].filter(name => definitions.some(tool => tool.name === name));
  const tools = definitions.filter(tool => names.includes(tool.name));
  const toolSnippets = Object.fromEntries(definitions.filter(tool => tool.promptSnippet?.trim()).map(tool =>
    [tool.name, tool.promptSnippet!.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim()]));
  const toolGuidelines = Object.fromEntries(definitions.filter(tool => tool.promptGuidelines?.length).map(tool =>
    [tool.name, [...new Set(tool.promptGuidelines!.map(text => text.trim()).filter(Boolean))]]));
  const systemPrompt = buildAxiomSystemPrompt({ cwd: input.cwd,
    customPrompt: loader.getSystemPrompt(), appendSystemPrompt: loader.getAppendSystemPrompt().join("\n\n"),
    skills: loader.getSkills().skills, contextFiles: loader.getAgentsFiles().agentsFiles,
    selectedTools: names, toolSnippets, toolGuidelines,
  });
  return {
    source: "preview", cwd: input.cwd, systemPrompt, tools: names,
    toolDefinitions: tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
    ...resources(loader, input.capabilities), memory: { topics: input.memoryTopics.text }, extensions: 0,
    retry: { ...sessionRetrySettings(settings), provider: settings.getProviderRetrySettings() },
    warnings: [...input.capabilities?.warnings ?? [],
      ...(projectSettings.drainErrors().length ? ["部分设置无法读取，预览使用其余可用配置。"] : []),
      ...(loader.getSkills().diagnostics.length ? ["部分技能有加载诊断，请检查资源定义。"] : []),
      "程序预加载，未启动 session。运行时扩展及 MCP 动态工具在执行加载后更新；MCP 列表表示所选配置，不代表已连接。"],
  };
}
