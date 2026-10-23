import { engineEnvironment, discoverEnginePaths } from "./rea-engines.js";
import { loadSkills, type McpExtensionOptions } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { errorMessage } from "../error-message.js";
import { inspectReaProgram, inspectReaSkill, reaConfigPath, reaPackageRoot, reaSkillName, readReaConfig } from "./rea-runtime.js";

type McpConfig = ReturnType<NonNullable<McpExtensionOptions["loadConfig"]>>;
type Server = McpConfig["servers"][number];
/** A readable built-in owns its name; general definitions are fallback only. */
export function addReaServer(mcp: McpConfig, server: Server) {
  mcp.servers = [server, ...mcp.servers.filter(item => item.name !== server.name)];
  // Invalid shadowed definitions must not disable a valid built-in. Keep all
  // file-level errors and errors belonging to other names for native validation.
  mcp.errors = mcp.errors.filter(error => !error.includes(`: server "${server.name}"`));
}
export function loadReaSkill(root: string, cwd: string, packageRoot: string) {
  const installation = inspectReaSkill(packageRoot);
  const loaded = loadSkills({ cwd, agentDir: join(root, "pi"), skillPaths: [installation.skillPath], includeDefaults: false });
  if (loaded.skills.length !== 1 || loaded.skills[0].name !== reaSkillName || loaded.diagnostics.length) throw Error("REA 技能未完整加载，请重新安装 REA 恢复官方文件。");
  return { ...loaded, files: installation.files };
}
type Resources = ReturnType<typeof loadSkills> & { managed: boolean; server?: Server; files: string[]; warning?: string };
export function reaResources(root: string, cwd: string): Resources {
  const files = [reaConfigPath(root)];
  try {
    const config = readReaConfig(root), packageRoot = reaPackageRoot(root, config);
    if (!packageRoot) return { managed: config.skillInstalled !== undefined, skills: [], diagnostics: [], files };
    const result: Resources = { skills: [], diagnostics: [], managed: true, files };
    if (config.mcpInstalled !== false) {
      try {
        const installation = inspectReaProgram(packageRoot, config.installation!.version);
        files.push(...installation.files);
        result.server = { name: "rea", source: reaConfigPath(root), scope: "extension", config: {
          command: process.execPath, args: [installation.entry, "mcp"], enabled: config.enabled,
          env: engineEnvironment(discoverEnginePaths(config.engines)),
          description: "REA · 逆向分析 JavaScript、应用程序与二进制文件", exposure: "codemode",
        } };
      } catch (error) { result.warning = `内置 REA MCP 未加载：${errorMessage(error, "请重新安装 REA。")}`; }
    }
    if (config.skillInstalled !== false) {
      files.push(join(packageRoot, "skills", reaSkillName, "SKILL.md"));
      try {
        const loaded = loadReaSkill(root, cwd, packageRoot);
        files.push(...loaded.files);
        result.skills = loaded.skills.map(skill => ({ ...skill, disableModelInvocation: !config.enabled }));
      } catch (error) { result.warning = [result.warning, `内置 REA 技能未加载：${errorMessage(error, "请重新安装 REA 恢复官方文件。")}`].filter(Boolean).join("\n"); }
    }
    return result;
  } catch (error) {
    return { managed: true, skills: [], diagnostics: [], files, warning: `内置 REA 未加载：${errorMessage(error, "请在内置工具中检查或重新安装。")}` };
  }
}
