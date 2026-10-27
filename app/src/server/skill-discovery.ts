import { loadSkills, type AgentSession } from "@earendil-works/pi-coding-agent";
import type { CapabilityRuntime } from "./capability-resources.js";
import { sessionSafePoint } from "./session-safe-point.js";

/** Refresh only the native skill resources at an already settled run boundary.
 * Pi copies skills into prompt options. Rebuild the base through its public tool
 * setter, then let the next prompt lifecycle run extension hooks and emit deltas.
 * Do not reload extensions, MCP, settings, or project instructions here.
 */
export function applySkillDiscovery(session: AgentSession, cwd: string, agentDir: string, next: CapabilityRuntime) {
  if (!sessionSafePoint({ phase: "idle" }, { session }).allows("resource-reload") || next.skillPaths === null || next.selection.skills === null)
    throw Error("技能自动发现只能在会话安全点应用。");
  const current = session.resourceLoader.getSkills();
  // Pi 1.1.0 exposes its resource arrays. Fail closed if a future SDK returns copies.
  const again = session.resourceLoader.getSkills();
  if (current.skills !== again.skills || current.diagnostics !== again.diagnostics)
    throw Error("pi 技能资源接口已变化，未应用本次选择；请更新适配后重试。");
  const loaded = loadSkills({ cwd, agentDir, skillPaths: next.skillPaths, includeDefaults: false });
  const automatic = new Set(next.selection.skills);
  if ([...automatic].some(name => !loaded.skills.some(skill => skill.name === name)))
    throw Error("选中的技能已不可用，未应用本次选择；请刷新技能列表后重试。");
  current.skills.splice(0, current.skills.length, ...loaded.skills.map(skill => ({ ...skill,
    disableModelInvocation: !automatic.has(skill.name) })));
  current.diagnostics.splice(0, current.diagnostics.length, ...loaded.diagnostics);
  session.setActiveToolsByName(session.getActiveToolNames());
}
