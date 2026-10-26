import { engineEnvironment, discoverEnginePaths } from "./rea-engines.js";
import { inspectNodeRuntime } from "./managed-node.js";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { errorMessage } from "../error-message.js";
import { inspectReaProgram, inspectReaSkill, reaConfigPath, reaPackageRoot, reaSkillName, reaNode, reaProcessEnvironment, reaDirectory, readReaConfig } from "./rea-runtime.js";
/** A readable built-in owns its name; general definitions are fallback only. */
export function addReaServer(mcp, server) {
    mcp.servers = [server, ...mcp.servers.filter(item => item.name !== server.name)];
    // Invalid shadowed definitions must not disable a valid built-in. Keep all
    // file-level errors and errors belonging to other names for native validation.
    mcp.errors = mcp.errors.filter(error => !error.includes(`: server "${server.name}"`));
}
export function loadReaSkill(root, cwd, packageRoot) {
    const installation = inspectReaSkill(packageRoot);
    const loaded = loadSkills({ cwd, agentDir: join(root, "pi"), skillPaths: [installation.skillPath], includeDefaults: false });
    if (loaded.skills.length !== 1 || loaded.skills[0].name !== reaSkillName || loaded.diagnostics.length)
        throw Error("REA 技能未完整加载，请重新安装 REA 恢复官方文件。");
    return { ...loaded, files: installation.files };
}
export function reaResources(root, cwd) {
    const files = [reaConfigPath(root)];
    try {
        const config = readReaConfig(root), packageRoot = reaPackageRoot(root, config);
        if (!packageRoot)
            return { managed: config.skillInstalled !== undefined, skills: [], diagnostics: [], files };
        const result = { skills: [], diagnostics: [], managed: true, files };
        if (config.mcpInstalled !== false) {
            try {
                const installation = inspectReaProgram(packageRoot, config.installation.version);
                files.push(...installation.files);
                if (config.installation?.runtime)
                    files.push(...inspectNodeRuntime(join(reaDirectory(root), "versions", config.installation.directory), config.installation.runtime).files);
                result.server = { name: "rea", source: reaConfigPath(root), scope: "extension", config: {
                        command: reaNode(root, config), args: [installation.entry, "mcp"], cwd: root, enabled: config.enabled,
                        env: Object.fromEntries(Object.entries({ ...reaProcessEnvironment(root, config), ...engineEnvironment(discoverEnginePaths(config.engines)) }).filter((entry) => entry[1] !== undefined)),
                        description: "REA · 逆向分析 JavaScript、应用程序与二进制文件", exposure: "codemode",
                    } };
            }
            catch (error) {
                result.warning = `内置 REA MCP 未加载：${errorMessage(error, "请重新安装 REA。")}`;
            }
        }
        if (config.skillInstalled !== false) {
            files.push(join(packageRoot, "skills", reaSkillName, "SKILL.md"));
            try {
                const loaded = loadReaSkill(root, cwd, packageRoot);
                files.push(...loaded.files);
                result.skills = loaded.skills.map(skill => ({ ...skill, disableModelInvocation: !config.enabled }));
            }
            catch (error) {
                result.warning = [result.warning, `内置 REA 技能未加载：${errorMessage(error, "请重新安装 REA 恢复官方文件。")}`].filter(Boolean).join("\n");
            }
        }
        return result;
    }
    catch (error) {
        return { managed: true, skills: [], diagnostics: [], files, warning: `内置 REA 未加载：${errorMessage(error, "请在内置工具中检查或重新安装。")}` };
    }
}
//# sourceMappingURL=rea-resources.js.map