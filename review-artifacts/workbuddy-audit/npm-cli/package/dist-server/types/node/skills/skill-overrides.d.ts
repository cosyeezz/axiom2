import type { Skill } from '@genie/product';
import { CliSettingSourcesProvider } from '../settings/cli-setting-sources-provider';
import { type SettingsManager, type SkillOverridesSetting, type SkillOverrideState } from '../settings/settings-protocol';
export type { SkillOverrideState, SkillOverridesSetting };
/** 判断一个值是否为合法的 skillOverrides 四态之一（用于过滤手改配置里的非法值）。 */
export declare function isValidSkillOverrideState(value: unknown): value is SkillOverrideState;
/**
 * 四态循环顺序（`/skills` 菜单按 Space / ←/→ 循环切换时使用）。
 */
export declare const SKILL_OVERRIDE_STATES: readonly SkillOverrideState[];
/**
 * `/skills` 菜单展示用的短标签：`user-invocable-only` → `user-only`（对齐 Claude Code 菜单标注，
 * 见其 skills 文档 "The /skills menu labels the user-invocable-only state user-only."）。
 * 注意：这只是**显示用**短标签；写入配置文件的始终是规范值（见 SKILL_OVERRIDE_STATES）。
 */
export declare function skillOverrideStateLabel(state: SkillOverrideState): string;
/** 计算可见性/覆盖态时依赖的最小 skill 字段集合。 */
type SkillLike = Pick<Skill, 'name' | 'source'> & {
    disableModelInvocation?: boolean;
    userInvocable?: boolean;
    pluginInfo?: Skill['pluginInfo'];
};
/**
 * 是否为 plugin skill。plugin skill 不受 `skillOverrides` 影响（改由 `/plugin` 管理），
 * 因此所有消费点在应用 override 前都必须先判断这一条。
 *
 * 识别方式与 plugin loader 保持一致：`source === 'plugin'` 或带有 `pluginInfo`。
 */
export declare function isPluginSkill(skill: Pick<Skill, 'source'> & {
    pluginInfo?: Skill['pluginInfo'];
}): boolean;
/**
 * 是否为内置（bundled）skill。`SkillProductProvider.loadSkills` 扫描内置目录时统一打
 * `source: 'bundled'`（见 skill-product-provider.ts）。
 *
 * 供 ACP `available_commands_update` 的 `_meta.isBuiltIn` 使用，语义对齐 plugin 侧
 * `PluginInfo.isBuiltIn`，让客户端可以统一按布尔字段隐藏内置资源，无需各自识别
 * `source` 的具体枚举值。
 */
export declare function isBuiltInSkill(skill: Pick<Skill, 'source'>): boolean;
/**
 * 解析某个 skill 的有效覆盖态。
 *
 * - plugin skill 恒为 `on`（豁免）。
 * - `overrides` 里未列出、或值非法 → `on`（缺省=on，回退 frontmatter）。
 */
export declare function resolveSkillOverrideState(skill: Pick<Skill, 'name' | 'source'> & {
    pluginInfo?: Skill['pluginInfo'];
}, overrides: SkillOverridesSetting | undefined): SkillOverrideState;
/**
 * 按优先级合并多个 scope 的 skillOverrides（低 → 高传入）。
 *
 * 关键语义（对齐需求）：**合并前先过滤掉非法值**——只有合法四态值才会覆盖更低优先级的值。
 * 因此高优先级 scope 里的非法值不会遮蔽低优先级 scope 里的合法值，会自动回退到"上一个有效文件"。
 */
export declare function mergeSkillOverridesByPriority(...scopesLowToHigh: (SkillOverridesSetting | undefined)[]): SkillOverridesSetting;
/**
 * 读取并合并生效的 skillOverrides。
 *
 * 优先级默认 `PROJECT_LOCAL > PROJECT > USER`（低→高依次应用，仅合法值覆盖），
 * 但实际 scope 集合与顺序由 `--setting-sources` 决定，并追加 CLI scope 为最高优先级
 * （见 resolveSkillOverrideScopes）——因此 `--setting-sources none/user` 的隔离与
 * `--settings` 注入都能正确生效，不再被写死的三 scope 直读击穿。
 *
 * 注：当工作区根即 home（`~`）时，PROJECT 与 USER 解析到同一文件，读到的内容相同，合并幂等。
 */
export declare function getMergedSkillOverrides(settingsManager: Pick<SettingsManager, 'get'>, sourcesProvider?: Pick<CliSettingSourcesProvider, 'getSettingScopes'>): Promise<SkillOverridesSetting>;
export interface SkillVisibility {
    /** 模型上下文可见性：`full`=名称+描述，`name-only`=仅名称，`hidden`=不列出。 */
    listedToModel: 'full' | 'name-only' | 'hidden';
    /** 是否出现在 `/` 菜单 / 补全 / ACP / SDK 命令列表中。 */
    menuVisible: boolean;
    /** 用户 `/skill-name` 是否放行（`false` = `off`）。 */
    userInvocable: boolean;
    /**
     * 模型经 Skill 工具按名调用是否放行（仅 `off` 为 `false`）。
     * 注意：`on` 与 `user-invocable-only` 即便对模型隐藏也保持 `true`——
     * 「不进模型清单」与「硬拦按名调用」是两件事，前者不蕴含后者（issue #67209）。
     */
    modelInvocable: boolean;
}
/**
 * 计算 skill 的有效可见性。
 *
 * - `on` / 缺省：回退 SKILL.md frontmatter（`listedToModel = !disableModelInvocation`，
 *   `menuVisible = userInvocable !== false`），与现状完全一致、零回归。
 * - `name-only` / `user-invocable-only` / `off`：显式覆盖 frontmatter（对齐 Claude Code
 *   “controls visibility from settings instead of the skill's own frontmatter”）。
 */
export declare function resolveSkillVisibility(skill: SkillLike, overrides: SkillOverridesSetting | undefined): SkillVisibility;
/**
 * `off` 状态下按名调用（`/skill-name` 或模型 Skill 工具）返回的禁用报错文案，
 * 与 Claude Code 对齐。
 */
export declare function skillDisabledViaOverridesMessage(skillName: string): string;
