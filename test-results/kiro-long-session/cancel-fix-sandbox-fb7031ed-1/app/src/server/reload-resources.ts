import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { CapabilityRuntime } from "./capability-resources.js";
import type { ReloadResource, ResourceSnapshot } from "../shared/reload.js";

const digest = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value) ?? "").digest("hex");
function fileRevision(path: string, fallback: unknown) {
  try { return digest(readFileSync(path, "utf8")); } catch { return digest(fallback); }
}
/** Capture immediately after loading; never re-read old resources at comparison time. No config values leave the worker. */
export function resourceSnapshot(session: AgentSession, capabilities?: CapabilityRuntime): ResourceSnapshot {
  const loader = session.resourceLoader;
  const settings = session.settingsManager.getSettings();
  const rows = (items: ReloadResource[]) => items.sort((a, b) => a.name.localeCompare(b.name));
  return {
    skills: rows(loader.getSkills().skills.map(skill => ({ name: `${skill.name} · ${skill.filePath}`,
      revision: digest({ file: fileRevision(skill.filePath, skill), disableModelInvocation: skill.disableModelInvocation }) }))),
    extensions: rows(loader.getExtensions().extensions.map(extension => ({ name: extension.path, revision: fileRevision(extension.resolvedPath, extension.path) }))),
    prompts: rows(loader.getPrompts().prompts.map(prompt => ({ name: `${prompt.name} · ${prompt.filePath}`, revision: digest(prompt.content) }))),
    themes: rows(loader.getThemes().themes.map((theme, index) => ({ name: theme.name ?? `主题 ${index + 1}`, revision: digest(theme.colors) }))),
    instructions: rows(loader.getAgentsFiles().agentsFiles.map(file => ({ name: file.path, revision: digest(file.content) }))),
    tools: rows(session.getAllTools().map(tool => ({ name: tool.name, revision: digest({ description: tool.description, parameters: tool.parameters, active: session.getActiveToolNames().includes(tool.name) }) }))),
    settings: rows([...Object.entries(settings).map(([name, value]) => ({ name, revision: digest(value) })),
      ...(capabilities?.mcp.servers.map(server => ({ name: `MCP · ${server.name}`, revision: digest(server.config) })) ?? []),
      ...(capabilities?.mcp.servers.length ? [{ name: "MCP · autoEnableCodemode", revision: digest(capabilities.mcp.autoEnableCodemode) }] : [])]),
  };
}
export function resourceWarnings(session: AgentSession, capabilities?: CapabilityRuntime) {
  const loader = session.resourceLoader;
  return [
    ...(capabilities?.warnings ?? []),
    ...(loader.getExtensions().errors.length ? [`${loader.getExtensions().errors.length} 个扩展加载失败，请检查扩展文件。`] : []),
    ...([['Skills', loader.getSkills().diagnostics], ['提示词模板', loader.getPrompts().diagnostics], ['主题', loader.getThemes().diagnostics]] as const)
      .flatMap(([name, diagnostics]) => diagnostics.length ? [`${name}有 ${diagnostics.length} 条加载诊断，请检查资源定义或同名冲突。`] : []),
  ];
}
