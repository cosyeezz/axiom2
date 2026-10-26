/**
 * Opt-in for a custom `.codebuddy/agents/*.md` to appear in the main-agent
 * picker (chip / 新建智能体 / 设为默认 / getAgents / set_agent).
 *
 * Canonical frontmatter: `mainAgent: true`.
 * Loader maps that to this tag. Do **not** reuse `main-mode` — that tag plus a
 * homonym file (`ptc.md`) would look like a shipped standing mode and refresh
 * over the user's file.
 *
 * Files without the field still load as @agent / subagents (WorkBuddy / Claude
 * subagent / 存量自定义). They just stay out of the four-mode picker.
 */
export declare const MAIN_AGENT_PRESET_TAG = "main-agent-preset";
/** Canonical YAML key written by create mode and create-by-AI. */
export declare const MAIN_AGENT_PRESET_FRONTMATTER_KEY = "mainAgent";
/** Same base template as Standard / Creator. Body of the .md becomes appendInstructions. */
export declare const MAIN_AGENT_PRESET_INSTRUCTIONS = "cli-agent-prompt";
export declare function isCustomMainAgentPreset(agent: {
    tags?: readonly string[];
} | undefined): boolean;
export interface MainAgentPresetFrontmatterRead {
    /** True only when a recognized key parses as boolean true. */
    readonly enabled: boolean;
    /** Present when a recognized key existed but was not a boolean. */
    readonly invalidRaw?: unknown;
}
/**
 * Read the picker opt-in from agent frontmatter. Canonical `mainAgent` wins
 * over `main_agent` when both are present.
 */
export declare function readMainAgentPresetFrontmatter(frontmatter: unknown): MainAgentPresetFrontmatterRead;
export declare function withMainAgentPresetTag(tags: readonly string[], enabled: boolean): string[];
