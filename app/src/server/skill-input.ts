import { closeSync, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import { parseFrontmatter, type Skill } from "@earendil-works/pi-coding-agent";
import { AppError } from "../shared/protocol.js";
import { skillsInput, type SkillInput } from "../shared/skills.js";
import { skillId } from "./capability-resources.js";

/** Both prompt and native Steering use the worker's actual allowed skill set. */
export function prepareSkillInput(text: string, requested: unknown, available: readonly Pick<Skill, "name" | "description" | "filePath">[]) {
  const references = skillsInput(requested);
  if (!references.length) return { prompt: text, metadata: undefined };
  const metadata: SkillInput = { text, skills: [] }, blocks: string[] = [];
  let total = 0;
  for (const reference of references) {
    const skill = available.find(item => skillId(item.filePath) === reference.id);
    if (!skill) throw new AppError("SKILL_UNAVAILABLE", `技能 ${reference.name} 未在当前会话加载，请勾选该技能并重新加载当前会话。`);
    let content: string;
    try {
      const path = realpathSync(skill.filePath), fd = openSync(path, "r");
      try {
        const before = fstatSync(fd);
        if (!before.isFile() || before.size > 128 * 1024 || total + before.size > 512 * 1024) throw Error();
        const bytes = Buffer.alloc(before.size + 1); let count = 0;
        while (count < bytes.length) { const n = readSync(fd, bytes, count, bytes.length - count, count); if (!n) break; count += n; }
        const after = fstatSync(fd);
        if (count !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || realpathSync(skill.filePath) !== path) throw Error();
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, count));
        if (content.includes("\0")) throw Error();
        total += count;
      } finally { closeSync(fd); }
    } catch { throw new AppError("SKILL_READ_FAILED", `无法完整读取技能 ${reference.name}；请检查文件权限、内容与大小（单个最多 128 KiB，合计 512 KiB）。`); }
    let parsed: ReturnType<typeof parseFrontmatter>;
    try { parsed = parseFrontmatter(content); }
    catch { throw new AppError("SKILL_INVALID", `技能 ${reference.name} 的 YAML 元数据无效，请修复文件后重试。`); }
    const name = typeof parsed.frontmatter.name === "string" ? parsed.frontmatter.name : skill.name;
    const description = parsed.frontmatter.description;
    if (!name || name.length > 200 || typeof description !== "string" || !description.trim() || description.length > 4096)
      throw new AppError("SKILL_INVALID", `技能 ${reference.name} 的名称或描述无效，请修复文件后重试。`);
    metadata.skills.push({ id: reference.id, name, description });
    blocks.push(`用户指定使用技能 ${JSON.stringify(name)}。文件位置：${JSON.stringify(skill.filePath)}；相对资源路径以 ${JSON.stringify(dirname(skill.filePath))} 为基准。\n\n${parsed.body}`);
  }
  return { prompt: `${blocks.join("\n\n")}\n\n用户请求：\n${text}`, metadata };
}
