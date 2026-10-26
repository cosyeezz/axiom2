import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { AppError } from "../shared/protocol.js";

// Use the YAML parser shipped with the pinned Pi SDK, which also reads these guides.
const { parseDocument, isMap } = createRequire(import.meta.resolve("@earendil-works/pi-coding-agent"))("yaml") as typeof import("yaml");

export function importSkillName(value: string) {
  const name = value.trim();
  if (!name || Buffer.byteLength(name) > 200 || /[\s\\/:*?"<>|\x00-\x1f\x7f]/.test(name) || /[.]$/.test(name) || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name))
    throw new AppError("INVALID_INPUT", "请填写有效的技能名称，不能包含空白、路径分隔符、系统保留名称或文件名特殊字符（最多 200 字节）。");
  return name;
}

/** Rewrite only the copied guide's metadata, preserving its Markdown body. */
export function nameImportedSkill(content: string, name: string) {
  const match = /^(\uFEFF?---[ \t]*\r?\n)([\s\S]*?)(\r?\n---[ \t]*(?:\r?\n|$))/.exec(content);
  if (!match) throw new AppError("INVALID_INPUT", "技能文件需要有效的 YAML 名称和说明，请检查文件开头的 --- 区域。");
  try {
    const metadata = parseDocument(match[2]);
    if (metadata.errors.length || !isMap(metadata.contents)) throw Error();
    const before = metadata.toJS();
    metadata.set("name", name);
    const yaml = metadata.toString().trimEnd();
    const after = parseDocument(yaml).toJS();
    if (after.name !== name || !isDeepStrictEqual({ ...before, name }, after)) throw Error();
    return match[1] + (match[1].endsWith("\r\n") ? yaml.replace(/\n/g, "\r\n") : yaml) + match[3] + content.slice(match[0].length);
  } catch { throw new AppError("INVALID_INPUT", "技能文件的 YAML 配置无效，请修复后重新安装。"); }
}
