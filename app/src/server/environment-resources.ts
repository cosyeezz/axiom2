import { join } from "node:path";
import { loadSkills, type DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
type DefaultResourceLoaderOptions = ConstructorParameters<typeof DefaultResourceLoader>[0];
import type { CapabilityRuntime } from "./capability-resources.js";
import { resolveBuiltinSkills } from "./builtin-capabilities.js";
import { openCliSkillNames } from "./integrations/opencli-runtime.js";
import type { openCliResources } from "./integrations/opencli-resources.js";
import type { reaResources } from "./integrations/rea-resources.js";
import { memoryInstruction } from "../shared/memory.js";

export interface EnvironmentResourceInput {
  root: string;
  cwd: string;
  memoryPath?: string;
  task?: unknown;
  capabilities?: CapabilityRuntime;
}
type Builtins = { opencli?: ReturnType<typeof openCliResources>; rea?: ReturnType<typeof reaResources> };
/** Shared by execution and the session-free preview. Read mutable inputs again on reload. */
export function environmentResourceOptions(input: EnvironmentResourceInput, builtins: () => Builtins, childPolicy = ""):
  Pick<DefaultResourceLoaderOptions, "noSkills" | "skillsOverride" | "appendSystemPromptOverride"> {
  return {
    noSkills: !input.task && input.capabilities?.skillPaths !== undefined && input.capabilities.skillPaths !== null,
    skillsOverride: (base) => {
      if (!input.task && input.capabilities?.skillPaths) {
        const loaded = loadSkills({ cwd: input.cwd, agentDir: join(input.root, "pi"),
          skillPaths: input.capabilities.skillPaths, includeDefaults: false });
        const automatic = new Set(input.capabilities.selection.skills ?? []);
        return { ...loaded, skills: loaded.skills.map(skill => ({ ...skill,
          disableModelInvocation: !automatic.has(skill.name) })) };
      }
      const { opencli, rea } = builtins();
      const general = input.task ? base.skills.filter(skill => !openCliSkillNames.includes(skill.name)) : base.skills;
      return { skills: resolveBuiltinSkills(general, [...opencli?.skills ?? [], ...rea?.skills ?? []]),
        diagnostics: [...base.diagnostics, ...opencli?.diagnostics ?? [], ...rea?.diagnostics ?? []] };
    },
    appendSystemPromptOverride: (base) => [...base, "引用本地文件时，使用 Markdown 链接 [文件名](路径)", ...(input.task
      ? [childPolicy]
      : [
          ...(input.memoryPath ? [memoryInstruction(input.memoryPath)] : []),
          "将适合委派的工作拆成独立子任务，独立测试优先并行。委派时交代背景、目标、范围、约束及交付要求；测试任务另给出工作目录、命令或测试范围、前置条件，并协调独立端口、临时目录和输出路径。有依赖或争用共享资源的任务按顺序执行。\n\n测试期间不要修改其覆盖的文件。委派后继续独立工作，不轮询；收到完成通知后用 read_result 读取对应结果，核对证据、实际命令、退出码、关键结果及未验证项。相关文件变化后重跑受影响的检查；文件未变且已验证的检查无需重复。应用调研建议前重新核对当前文件。代码修改由主代理完成。",
        ])],
  };
}
