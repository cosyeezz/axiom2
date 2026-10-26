import { Agent } from '@genie/product';
export type AgentDisplaySource = 'user' | 'project' | 'managed' | 'plugin' | 'cli-arg' | 'built-in';
export interface AgentSourceGroup {
    readonly label: string;
    readonly source: AgentDisplaySource;
}
/**
 * Ordered list of agent source groups for display. Mirrors Claude Code's
 * `AGENT_SOURCE_GROUPS` so `codebuddy agents` reads like `claude agents`.
 * genie has no `local` scope, so that group is intentionally omitted.
 */
export declare const AGENT_SOURCE_GROUPS: readonly AgentSourceGroup[];
export interface AgentDisplayInfo {
    readonly name: string;
    /** Picker / list label; falls back to `name` when unset. */
    readonly displayName?: string;
    readonly source: AgentDisplaySource;
    /** 文本行展示用模型标签（逗号拼接，未声明为 'inherit'，对齐 CC）。 */
    readonly model: string;
    /** 声明的模型列表（JSON 输出用）；未声明时为空数组，JSON 输出 null（继承）。 */
    readonly models: readonly string[];
    readonly description?: string;
    /** 持久记忆 scope（user/project/local），对齐 Claude Code 列表展示。 */
    readonly memory?: string;
    /** 工具集（显式白名单）；继承全部工具时为空，JSON 输出为 '*'。 */
    readonly tools?: readonly string[];
}
export interface GroupedAgents {
    readonly groups: ReadonlyArray<{
        readonly group: AgentSourceGroup;
        readonly agents: AgentDisplayInfo[];
    }>;
    readonly total: number;
}
/** Options for {@link isHiddenAgent} / {@link classifyAgentSource}. */
export interface AgentDisplayOptions {
    /**
     * Keep internal generator agents (compact, contextSummary, classifiers, …)
     * in the list. The `/agents` TUI panel needs them visible because they carry
     * the "Enter to edit model" affordance (Issue #66763); the `codebuddy agents`
     * CLI hides them for Claude Code parity (`claude agents` doesn't list them).
     */
    includeInternal?: boolean;
}
/**
 * Whether an agent config should be hidden from the user-facing list.
 * Always excludes the main/default agent and the synthetic `fork` agent;
 * internal generator agents (compaction, summaries, classifiers, …) are
 * excluded unless `includeInternal` is set (see {@link AgentDisplayOptions}).
 */
/** Product default (`cli`) carries the `default` tag and is hidden from `/agents` lists. */
export declare function isProductDefaultAgent(agent: {
    tags?: readonly string[];
}): boolean;
export declare function isHiddenAgent(agent: Agent, options?: AgentDisplayOptions): boolean;
/**
 * Classify a product `Agent` into its display source group, or `undefined` when
 * the agent should not be listed. The product configuration is already merged
 * across scopes/providers, so every listed agent is the winning definition.
 */
export declare function classifyAgentSource(agent: Agent, options?: AgentDisplayOptions): AgentDisplaySource | undefined;
/**
 * Model label for display: declared model(s), or `inherit` when unset (the agent
 * inherits the main session model at runtime).
 */
export declare function resolveAgentModelDisplay(agent: Agent): string;
/** `name · model · <scope> memory` — 对齐 Claude Code 的 agents 列表行展示。 */
export declare function formatAgentLine(info: AgentDisplayInfo): string;
/**
 * Group and sort product agents by display source. Agents that shouldn't be
 * listed are dropped, and empty groups are omitted.
 */
export declare function groupAgentsForDisplay(agents: readonly Agent[]): GroupedAgents;
/** Render the human-readable `codebuddy agents` output. */
export declare function renderAgentsList(grouped: GroupedAgents): string;
/** Render machine-readable JSON for `codebuddy agents --json`. */
export declare function renderAgentsJson(grouped: GroupedAgents): string;
