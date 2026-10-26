/**
 * Admin-trusted source gate for frontmatter hooks.
 *
 * Aligns with Claude Code's `isSourceAdminTrusted` in `runAgent.ts:566`:
 * frontmatter hooks declared on user-local `.codebuddy/agents/*.md` or
 * `.codebuddy/skills/SKILL.md` can silently spawn shell commands. We gate
 * their registration so users must opt-in via the
 * `allowUntrustedFrontmatterHooks` setting, unless the source is already
 * admin-trusted (product built-in agents/skills).
 */
import { Agent as ProductAgent, Skill } from '@genie/product';
/**
 * An agent is admin-trusted when it's NOT tagged as a custom agent —
 * i.e. product-bundled agents shipped inside cbc itself.
 *
 * Custom agents include:
 * - `.codebuddy/agents/*.md` (user/project local)
 * - plugin marketplace agents
 *
 * Both of these default to "untrusted" for frontmatter hooks; enable via
 * the `allowUntrustedFrontmatterHooks` setting.
 */
export declare function isAgentAdminTrusted(agent: ProductAgent | undefined): boolean;
/**
 * A skill is admin-trusted only when it's bundled inside cbc itself
 * (future: product.skills). Currently all discovered skills come from
 * `skill-loader.ts` which unconditionally assigns `source: 'plugin'` —
 * so today this function effectively returns `false` for every skill
 * we see at runtime, forcing the `allowUntrustedFrontmatterHooks` gate.
 *
 * Called by `skill-tool.ts` when the fork path carries SKILL.md
 * `hooks:` frontmatter into the subagent lifecycle.
 */
export declare function isSkillAdminTrusted(skill: Skill | undefined): boolean;
/**
 * Resolve whether frontmatter hooks from a given source should be registered.
 *
 * @param isAdminTrusted Whether the source (agent/skill) is admin-trusted
 * @param allowUntrusted Settings flag `allowUntrustedFrontmatterHooks`
 */
export declare function shouldRegisterFrontmatterHooks(isAdminTrusted: boolean, allowUntrusted: boolean | undefined): boolean;
