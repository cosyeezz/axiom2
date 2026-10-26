import { join } from "node:path";
import { loadSkills, type DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
type DefaultResourceLoaderOptions = ConstructorParameters<typeof DefaultResourceLoader>[0];
import type { CapabilityRuntime } from "./capability-resources.js";
import { resolveBuiltinSkills } from "./builtin-capabilities.js";
import { openCliSkillNames } from "./integrations/opencli-runtime.js";
import type { openCliResources } from "./integrations/opencli-resources.js";
import type { reaResources } from "./integrations/rea-resources.js";
import { memoryInstruction } from "../shared/memory.js";
import { modelQuestionInstruction } from "../shared/model-question.js";
import { piDevelopmentSkillPath } from "./axiom-prompt.js";

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
      const development = loadSkills({ cwd: input.cwd, agentDir: join(input.root, "pi"),
        skillPaths: [piDevelopmentSkillPath], includeDefaults: false });
      const general = input.task ? base.skills.filter(skill => !openCliSkillNames.includes(skill.name)) : base.skills;
      return { skills: resolveBuiltinSkills([...general, ...development.skills], [...opencli?.skills ?? [], ...rea?.skills ?? []]),
        diagnostics: [...base.diagnostics, ...development.diagnostics, ...opencli?.diagnostics ?? [], ...rea?.diagnostics ?? []] };
    },
    appendSystemPromptOverride: (base) => [...base, "When referencing files, use Markdown links: [filename](path)", ...(input.task
      ? [childPolicy, modelQuestionInstruction]
      : [
          ...(input.memoryPath ? [memoryInstruction(input.memoryPath)] : [modelQuestionInstruction]),
          "Split work suitable for delegation into independent subtasks, prioritizing parallel execution for independent tests. Provide the background, goal, scope, constraints, and deliverables. For test tasks, also provide the working directory, commands or test scope, and prerequisites; coordinate separate ports, temporary directories, and output paths. Run tasks sequentially when they depend on each other or compete for shared resources.\n\nDo not modify files while tests covering them are running. After delegating, continue independent work without polling. When a completion notification arrives, use read_result to retrieve the corresponding result and check the evidence, actual commands, exit codes, key results, and unverified items. Rerun affected checks after relevant files change; do not repeat passed checks when the files are unchanged. Recheck current files before applying research recommendations. The main agent makes code changes.",
        ])],
  };
}
