import { AppError, object } from "./protocol.js";

/** Names resolve current resources; descriptions are display snapshots only. */
export type SkillReference = { id: string; name: string; description: string };
export type SkillInput = { text: string; skills: SkillReference[] };
export function persistedSkillInput(message: any): SkillInput | undefined {
  const value = message.axiomSkillInput ?? message.details?.skillInput;
  if (!value || typeof value.text !== "string") return;
  try { const skills = skillsInput(value.skills); return skills.length ? { text: value.text, skills } : undefined; }
  catch { return undefined; }
}

export const maxMessageSkills = 32;
export const maxDraftSkills = 2048;
export function skillsInput(value: unknown, limit = maxMessageSkills): SkillReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > limit) throw new AppError("INVALID_INPUT", limit === maxMessageSkills ? "每条消息最多使用 32 个技能；请先移除多余引用" : `草稿最多保留 ${limit} 个技能引用`);
  const result = value.map(item => {
    const p = object(item);
    if (Object.keys(p).some(key => !["id", "name", "description"].includes(key)) ||
      typeof p.id !== "string" || (p.id !== p.name && !/^[a-f0-9]{64}$/.test(p.id)) ||
      typeof p.name !== "string" || !p.name.trim() || p.name.length > 200 ||
      typeof p.description !== "string" || p.description.length > 4096 || /\0/.test(p.name + p.description))
      throw new AppError("INVALID_INPUT", "技能引用无效，请重新添加");
    // Accept historical path hashes in stored drafts/messages, then use names.
    return { id: p.name, name: p.name, description: p.description };
  });
  if (new Set(result.map(item => item.id)).size !== result.length) throw new AppError("INVALID_INPUT", "技能不能重复添加");
  return result;
}
