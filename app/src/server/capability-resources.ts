import { modelToolTransport } from "./integrations/model-proxy-tools.js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  DefaultPackageManager, SettingsManager, loadSkills, createMcpExtension,
  createCodemodeExtension, createToolSearchExtension,
  type McpExtensionOptions, type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import type { CapabilityItem, CapabilitySelection } from "../shared/capabilities.js";
import { openCliResources } from "./integrations/opencli-resources.js";
import { addReaServer, reaResources } from "./integrations/rea-resources.js";
import { builtinCapability, resolveBuiltinSkills } from "./builtin-capabilities.js";
import { reaConfigPath } from "./integrations/rea-runtime.js";

type McpConfig = ReturnType<NonNullable<McpExtensionOptions["loadConfig"]>>;
// Pi 1.1.0 exports the extension, but not its config reader. Keep the version-bound
// bridge here so discovery and execution use Pi's validation and merge semantics.
const mcpModule = import(new URL("./extensions/mcp/config.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href) as
  Promise<{ loadMcpConfig(options: { cwd: string; agentDir: string; projectTrusted: boolean }): McpConfig }>;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const skillId = (path: string) => hash(process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path));
export function capabilityFileDigest(path: string) {
  try { return hash(readFileSync(path)); }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable"; }
}
export type CapabilityRuntime = {
  selection: CapabilitySelection;
  skillPaths: string[] | null;
  mcp: McpConfig;
  files: { path: string; digest: string }[];
  warnings: string[];
};
export async function discoverCapabilities(root: string, cwd: string, sharedPiDir = join(root, "pi")) {
  const agentDir = join(root, "pi");
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
  const warnings: string[] = [];
  if (settingsManager.drainErrors().length) warnings.push("部分技能设置无法读取或格式无效，请检查 settings.json。");
  const packages = new DefaultPackageManager({ cwd, agentDir, settingsManager });
  // Never install packages or execute extensions just to display the catalog.
  const paths = await packages.resolve(async () => { warnings.push("部分资源包尚未安装，未列出其中的技能。"); return "skip"; });
  const skillFile = (item: typeof paths.skills[number]) => {
    if (item.metadata.source === "auto" || item.metadata.origin === "package") {
      try { if (statSync(item.path).isDirectory() && existsSync(join(item.path, "SKILL.md"))) return join(item.path, "SKILL.md"); }
      catch { /* The reader reports missing resources. */ }
    }
    return item.path;
  };
  const skillPaths = paths.skills.filter(item => item.enabled).map(skillFile);
  const sharedSkills = join(sharedPiDir, "skills");
  if (skillId(sharedPiDir) !== skillId(agentDir) && existsSync(sharedSkills)) {
    // Resolve the added source through Pi's exclusion rules, without importing
    // terminal settings/packages/extensions or changing existing precedence.
    const scoped = {
      global: { skills: [sharedSkills, ...(settingsManager.getGlobalSettings().skills ?? [])] },
      project: { skills: settingsManager.getProjectSettings().skills ?? [] },
    };
    const supplementalSettings = SettingsManager.fromStorage({
      withLock: (scope, read) => { read(JSON.stringify(scoped[scope])); },
    }, { projectTrusted: true });
    const supplemental = await new DefaultPackageManager({ cwd, agentDir, settingsManager: supplementalSettings }).resolve(async () => "skip");
    // Include disabled paths in the identity set so the additional scan cannot
    // re-enable a resource already excluded by its original source.
    const identity = (path: string) => {
      try { return skillId(realpathSync(path)); } catch { return skillId(path); }
    };
    const known = new Set(paths.skills.map(item => identity(skillFile(item))));
    for (const item of supplemental.skills) {
      const path = skillFile(item), id = identity(path);
      if (item.enabled && !known.has(id)) { skillPaths.push(path); known.add(id); }
    }
  }
  const loaded = loadSkills({ cwd, agentDir, skillPaths, includeDefaults: false });
  const opencli = openCliResources(root, cwd), rea = reaResources(root, cwd);
  const builtinSkills = [...opencli.skills, ...rea.skills];
  const skills = resolveBuiltinSkills(loaded.skills, builtinSkills);
  if (loaded.diagnostics.length || opencli.diagnostics.length) warnings.push("部分技能存在重复或格式问题，仅列出可读取的有效项。");
  if (opencli.warning) warnings.push("OpenCLI 技能未完整加载，请在内置工具设置中检查。");
  if (rea.warning) warnings.push(rea.warning);
  // Skills and MCP share the host's resolved model/credential directory;
  // application settings and its existing resource sources stay independent.
  const mcp = (await mcpModule).loadMcpConfig({ cwd, agentDir: sharedPiDir, projectTrusted: true });
  const generalServers = [...mcp.servers];
  if (rea.server) addReaServer(mcp, rea.server);
  // Parser diagnostics can contain JSON excerpts, URLs or credentials. Never return them.
  if (mcp.errors.length) warnings.push("部分 MCP 配置无法读取或格式无效，请检查配置文件。");
  const skillItems: CapabilityItem[] = skills.map(skill => {
    const builtin = builtinCapability("skills", skill.name);
    return { id: skill.name, name: skill.name, builtin, fallback: builtin ? !builtinSkills.includes(skill) : undefined,
      preferenceKey: builtin ? skill.name : (() => { try { return skillId(realpathSync(skill.filePath)); } catch { return skillId(skill.filePath); } })(),
      description: skill.description, source: skill.filePath, defaultSelected: !skill.disableModelInvocation, available: true };
  });
  const mcpItems: CapabilityItem[] = mcp.servers.map(server => {
    const builtin = builtinCapability("mcp", server.name);
    return { id: server.name, name: server.name, builtin, fallback: builtin ? server !== rea.server : undefined,
      preferenceKey: builtin ? server.name : hash(JSON.stringify([resolve(server.source), server.name])),
      description: server.config.description ?? ("command" in server.config ? "本地 MCP 服务" : "远程 MCP 服务"),
      source: server.override ?? server.source, defaultSelected: server.config.enabled !== false, available: true };
  });
  const mcpPaths = [join(sharedPiDir, "mcp.json"), join(cwd, ".pi", "mcp.json")];
  const files = [...new Set([...skills.map(skill => skill.filePath), ...mcpPaths, ...rea.files,
    join(agentDir, "settings.json"), join(cwd, ".pi", "settings.json")])].map(path => {
      const digest = capabilityFileDigest(path);
      if (digest === "unreadable") warnings.push("部分能力文件无法读取，已保留其他可用资源；请检查文件类型与权限。");
      return { path, digest };
    });
  const preferenceAliases = {
    skills: Object.fromEntries(skillItems.filter(item => item.builtin).map(item => [item.name, [
      ...(item.builtin === "rea" ? [hash(reaConfigPath(root) + ":skill")] : []),
      ...[...builtinSkills, ...loaded.skills].filter(skill => skill.name === item.name).flatMap(skill => {
        try { return [skillId(realpathSync(skill.filePath)), skillId(skill.filePath)]; } catch { return [skillId(skill.filePath)]; }
      }),
    ]])),
    mcp: Object.fromEntries(mcpItems.filter(item => item.builtin).map(item => [item.name,
      [hash(JSON.stringify([resolve(reaConfigPath(root)), item.name])),
        ...[...mcp.servers, ...generalServers].filter(server => server.name === item.name)
          .map(server => hash(JSON.stringify([resolve(server.source), server.name])))]])),
  };
  return { skills: skillItems, mcp: mcpItems, preferenceAliases, warnings: [...new Set(warnings)], mcpPaths,
    revision: hash(JSON.stringify({ skillItems, mcpItems, files })), config: mcp, files };
}
export type DiscoveredCapabilities = Awaited<ReturnType<typeof discoverCapabilities>>;
export function capabilityRuntime(catalog: DiscoveredCapabilities, selection: CapabilitySelection): CapabilityRuntime {
  return {
    selection,
    // Selection controls model discovery, not explicit use. Keep every valid
    // catalog skill available to /skill:name and structured references.
    skillPaths: selection.skills === null ? null : catalog.skills.map(item => item.source),
    mcp: { servers: catalog.config.servers.filter(server => selection.mcp.includes(server.name))
      .map(server => ({ ...server, config: { ...server.config, enabled: true } })), errors: [], autoEnableCodemode: catalog.config.autoEnableCodemode },
    files: catalog.files,
    warnings: catalog.warnings,
  };
}
export function capabilityExtensions(runtime: CapabilityRuntime, root: string): ExtensionFactory[] {
  // Factories run again on native reload. Read the mutable runtime at invocation
  // so even a session starting without MCP can explicitly enable it later.
  return [async pi => {
    if (!runtime.mcp.servers.length) return;
    await createCodemodeExtension({ mode: "on" })(pi);
    await createToolSearchExtension()(pi);
    const mcp = createMcpExtension({ createTransport: modelToolTransport, loadConfig: () => structuredClone(runtime.mcp), logPath: join(root, "pi", "mcp.log"),
      updateConfig: () => { throw Error("请在技能与 MCP 面板修改选择，再重新加载会话。"); } });
    await mcp({ ...pi, getMcpServers: () => [], registerCommand: () => {} });
  }];
}
