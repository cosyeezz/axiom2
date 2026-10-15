import { loadSkills } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { errorMessage } from "../error-message.js";
import { openCliEnvironment, openCliSkillNames, openCliSkillPaths, readOpenCliConfig } from "./opencli-runtime.js";

type Resources = ReturnType<typeof loadSkills> & { managed: boolean; env?: NodeJS.ProcessEnv; warning?: string };
/** Optional integrations must not prevent the main coding agent from starting. */
export function openCliResources(root: string, cwd: string): Resources {
  try {
    const config = readOpenCliConfig(root);
    if (!config) return { managed: false, skills: [], diagnostics: [] };
    const loaded = loadSkills({ cwd, agentDir: join(root, "pi"), skillPaths: openCliSkillPaths(config), includeDefaults: false });
    if (config.enabled && (loaded.skills.length !== 2 || loaded.skills.some((skill) => !openCliSkillNames.includes(skill.name))))
      throw Error("官方常用技能未完整加载，请重新检查 OpenCLI 安装。");
    return { ...loaded, managed: true, env: openCliEnvironment(config) };
  } catch (error) {
    return { managed: true, skills: [], diagnostics: [], warning: `本轮未加载 OpenCLI 接入：${errorMessage(error, "请到配置 → 内置工具检查。")}` };
  }
}
