/**
 * Skill frontmatter 可见性字段派生。
 *
 * `disable: true` 只等价于 `disable-model-invocation: true`：
 * skill 仍进入 product.skills，且**保留** `/` 菜单可见性（`user-invocable` 保持默认 true），
 * 只是不进模型默认上下文；模型通过 skill 工具按准确名称调用仍可找到（见 issue #67209）。
 *
 * 显式声明的 `user-invocable` / `disable-model-invocation` 优先于 disable 派生。
 *
 * 注：本仓库这层语义有意与 Claude Code 不同 —— CC 的 `disable:true` 会同时隐藏
 * `/` 菜单；本仓库把菜单可见性与模型上下文可见性拆成两个独立位。
 */
export interface SkillFrontmatterVisibility {
    disable?: boolean;
    'user-invocable'?: boolean;
    'disable-model-invocation'?: boolean;
}
/**
 * 从 frontmatter 派生 `userInvocable` 和 `disableModelInvocation` 两个运行时字段。
 * 仅在 frontmatter 未显式声明对应字段时，才由 `disable` 派生（且仅派生
 * `disableModelInvocation`，不派生 `userInvocable`）。
 */
export declare function deriveSkillVisibility(frontmatter: SkillFrontmatterVisibility): {
    userInvocable?: boolean;
    disableModelInvocation?: boolean;
};
