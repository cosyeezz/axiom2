import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { AppError } from "../shared/protocol.js";
import { skillsInput, type SkillInput } from "../shared/skills.js";

/** pi 1.1.0 has no public expansion-only API. Reuse the exact synchronous
 * /skill:name loader used by prompt()/steer(), without queueing extra turns or
 * replacing their receipt metadata. Keep this version-bound adapter isolated;
 * never fall back to a host implementation of skill file parsing/loading.
 */
export function prepareSkillInput(text: string, requested: unknown, session: AgentSession) {
  const references = skillsInput(requested);
  if (!references.length) return { prompt: text, metadata: undefined };
  const available = session.resourceLoader.getSkills().skills;
  const skills = references.map(reference => {
    const skill = available.find(item => item.name === reference.name);
    if (!skill) throw new AppError("SKILL_UNAVAILABLE", `技能 ${reference.name} 当前不可用，请刷新技能列表；运行中的会话新增技能后需重新加载。`);
    // Match the same exact name used by Pi's native command expansion.
    if (/\s/.test(skill.name) || available.filter(item => item.name === skill.name).length !== 1)
      throw new AppError("SKILL_UNAVAILABLE", `技能 ${skill.name} 无法唯一匹配原生命令，请刷新技能列表。`);
    return skill;
  });
  const expand: unknown = Reflect.get(session, "_expandSkillCommand");
  if (typeof expand !== "function")
    throw new AppError("SKILL_NATIVE_UNSUPPORTED", "pi 原生技能命令接口已变化，未发送本次输入；请更新适配后重试。");
  const metadata: SkillInput = { text, skills: skills.map(skill => ({ id: skill.name, name: skill.name, description: skill.description })) };
  let prompt = text;
  // Repeated native expansion preserves the selected order and one input/turn.
  // Each native invocation owns file reading, frontmatter stripping and paths.
  for (const skill of [...skills].reverse()) {
    const command = `/skill:${skill.name}${prompt ? ` ${prompt}` : ""}`;
    const expanded: unknown = expand.call(session, command);
    if (typeof expanded !== "string" || expanded === command)
      throw new AppError("SKILL_READ_FAILED", `pi 未能加载技能 ${skill.name}，未发送本次输入；请检查技能文件并重新加载会话。`);
    if (!expanded.startsWith(`<skill name="${skill.name}" location="`))
      throw new AppError("SKILL_NATIVE_UNSUPPORTED", "pi 原生技能命令结果格式已变化，未发送本次输入；请更新适配后重试。");
    prompt = expanded;
  }
  return { prompt, metadata };
}
