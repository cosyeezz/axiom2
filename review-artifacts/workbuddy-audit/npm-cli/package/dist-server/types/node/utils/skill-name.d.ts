import * as path from 'node:path';
/**
 * skill 目录相对 rootDir 的路径段。rootDir 缺省时返回空数组（调用方回退 basename）。
 * skill 名（`:` 连接）、skill id（`/` 连接）、路径深度都由这个规则派生，收敛于此。
 */
export declare function relativeSkillDirSegments(skillDir: string, rootDir?: string, paths?: typeof path): string[];
/**
 * 从 SKILL.md 文件路径推导 skill 名（对齐 Claude Code：始终用「skill 目录」的
 * 相对路径推导，不从文件路径剥文件名）。
 *
 * - 嵌套目录用冒号连接（`category:skill-name`）；
 * - rootDir 缺省、或就是 skill 目录本身（plugin.json 按目录声明 skills、会话注入
 *   单 skill 目录等场景）时，回退目录 basename。
 */
export declare function deriveSkillNameFromPath(filePath: string, rootDir?: string, paths?: typeof path): string;
/**
 * 派生 skill 的稳定去重标识：`${source}::${相对根目录的路径}`。见 `Skill.id`。
 *
 * 相对 `deriveSkillNameFromPath` 的关键差异：始终带 `source` 前缀、用 `/` 保留完整
 * 相对路径（而非 `:` 拼段）——因此不与 frontmatter 显式 `name` 冲突，也能区分跨
 * source 的同路径 skill。
 */
export declare function deriveSkillIdFromPath(source: string, filePath: string, rootDir?: string, paths?: typeof path): string;
/**
 * 原地稳定排序 skill 列表：深度浅优先（根级排在同名深层之前），深度相同按 location
 * 字典序。消除 `readdir()` 未排序、不稳定顺序导致的「同名 skill winner 翻盘」
 * （issue #7976）——同名共存时 `findSkill` 取第一个即恒命中根级/就近 skill。
 *
 * 深度定义复用 `relativeSkillDirSegments`，与 `deriveSkillIdFromPath` 的路径分段口径
 * 一致；`SkillProductProvider` 与 `SkillExtensionLoader` 共用此函数，排序规则单点维护。
 */
export declare function sortSkillsByDepth<T extends {
    location: string;
}>(skills: T[], rootDir?: string, paths?: typeof path): void;
/**
 * 返回「非空字符串」原值，否则返回 undefined（让调用方走兜底）。做的是校验/过滤，
 * 不做类型转换——非字符串（number/boolean/null/object）一律视为无效。
 *
 * 存在意义：SKILL.md frontmatter 由完整 YAML parser 解析时，`name: 1024` /
 * `name: true` 这类无引号裸标量会被解析成 number / boolean（YAML core schema）。
 * 旧代码 `frontmatter.name || fallback` 里这种 truthy 非字符串会短路兜底、被直接当成
 * `skill.name`，随后 `skill.name.includes(':')` 对 number 调用 `.includes` 抛
 * `TypeError: ...name.includes is not a function`，整个 rebuildAgents 崩溃、default
 * agent 注册不上，用户会话起不来。用本函数把「非字符串」挡在 skill 对象之外。
 */
export declare function asNonEmptyString(value: unknown): string | undefined;
