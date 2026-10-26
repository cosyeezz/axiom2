export { MAIN_AGENT_PRESET_TAG } from './main-agent-preset';
/**
 * Shipped main-agent mode ids that travel with the CLI install bundle.
 * Display names live in the Web i18n map (`agent-labels.ts`), not here.
 *
 * The modes are injected at runtime by `BuiltinMainAgentModesProvider`
 * (packages/agent-cli), not by patching tracked product.json files.
 *
 * WorkBuddy Desktop does not opt into the picker; do not treat presence of an
 * id as “WorkBuddy UI should show a seat”.
 */
export declare const BUILTIN_AGENT_MODE_NAMES: readonly ["cli", "ptc", "minimal", "create", "multitask"];
export type BuiltinAgentModeName = (typeof BUILTIN_AGENT_MODE_NAMES)[number];
export declare const MAIN_MODE_AGENT_TAG = "main-mode";
export declare function isBuiltinAgentModeName(name: string | undefined): name is BuiltinAgentModeName;
/**
 * Chip / getAgents / set_agent / 新会话盖章只认四套 shipped + 带
 * `mainAgent: true`（加载后 `main-agent-preset`）的自定义 agent。
 * 普通 `.codebuddy/agents/*.md` / Explore / Plan 不当站立主 Agent。
 */
export declare function isStandingMainAgentCandidate(agent: {
    name?: string;
    tags?: readonly string[];
}, defaultAgentName: string): boolean;
/**
 * 主会话提示词管线：产品默认 + 四套 shipped + 带 `mainAgent: true` 的自定义预设。
 * 普通自定义 .md 仍走 markdown body 当完整 instructions。
 */
export declare function usesMainAgentPromptPipeline(agent: {
    name?: string;
    tags?: readonly string[];
}, defaultAgentName: string): boolean;
/** settings lastUsed/default 里残留的子代理名，解析链直接跳过。 */
export declare function isBuiltinSubagentStandingName(name: string | undefined): boolean;
export declare function tuiModeLabel(name: string | undefined): string | undefined;
export declare function tuiModeShortDescription(name: string | undefined): string | undefined;
/**
 * TUI chrome color keys (theme.colors). Distinct per shipped mode;
 * every custom agent shares one extra gold (`delegateMode`).
 */
export type TuiModeColorName = 'info' | 'planMode' | 'success' | 'warning' | 'delegateMode';
export declare function tuiModeColorName(agentName?: string, custom?: boolean): TuiModeColorName;
export declare function builtinModeLocale(language?: string): 'zh' | 'en';
export declare function localizeBuiltinAgentMode(name: string | undefined, language?: string): {
    displayName: string;
    description: string;
} | undefined;
