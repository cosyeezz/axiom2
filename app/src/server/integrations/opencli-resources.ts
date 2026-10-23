import { loadSkills } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { errorMessage } from "../error-message.js";
import { openCliEnvironment, openCliSkillNames, readOpenCliConfig } from "./opencli-runtime.js";

type Resources = ReturnType<typeof loadSkills> & { managed: boolean; env?: NodeJS.ProcessEnv; warning?: string };
/** Optional integrations must not prevent the main coding agent from starting. */
export function openCliResources(root: string, cwd: string): Resources {
  try {
    const config = readOpenCliConfig(root);
    if (!config) return { managed: false, skills: [], diagnostics: [] };
    const skillPaths = openCliSkillNames.map(name => join(config.packageRoot, "skills", name, "SKILL.md")).filter(path => existsSync(path));
    const loaded = loadSkills({ cwd, agentDir: join(root, "pi"), skillPaths, includeDefaults: false });
    const skills = loaded.skills.filter(skill => openCliSkillNames.includes(skill.name))
      .map(skill => ({ ...skill, disableModelInvocation: !config.enabled || skill.disableModelInvocation }));
    const warning = config.enabled && skills.length !== openCliSkillNames.length
      ? "OpenCLI 官方常用技能未完整加载，缺少的技能将尝试从通用目录读取。" : undefined;
    return { ...loaded, skills, managed: true, env: openCliEnvironment(config), warning };
  } catch (error) {
    return { managed: true, skills: [], diagnostics: [], warning: `本轮未加载 OpenCLI 接入：${errorMessage(error, "请到配置 → 内置工具检查。")}` };
  }
}
