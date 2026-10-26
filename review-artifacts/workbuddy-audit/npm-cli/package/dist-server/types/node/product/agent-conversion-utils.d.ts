import '../agent/agent-config-cli-fields';
import type { Logger } from '@celljs/core';
import type { Agent } from '@genie/product';
/**
 * Agent 定义形状 —— CLI flag --agents 与 SDK initialize control_request 共用。
 */
declare const definitionOptions: readonly ["appendInstructions", "background", "color", "effort", "hooks", "initialPrompt", "isolation", "maxTurns", "memory", "permissionMode", "skills"];
type AgentDefinitionOptions = Pick<Agent, typeof definitionOptions[number]>;
export interface ExternalAgentDefinition extends AgentDefinitionOptions {
    description: string;
    prompt: string;
    tools?: string[];
    disallowedTools?: string[];
    model?: string;
    /**
     * MCP servers（对齐 Claude subagent 的 mcpServers）：
     * 元素为名称引用字符串，或 `{ name: config }` 内联定义
     * （与 `.codebuddy/agents/*.md` frontmatter 的 mcpServers 同构，
     * 运行时统一由 AgentScopedMcpManager 在子代理 spawn 时消费）。
     */
    mcpServers?: Array<string | Record<string, unknown>>;
}
/**
 * 把外部传入的 agent 定义（CLI flag 或 SDK initialize）转成 Product Agent。
 *
 * 返回 undefined 表示验证失败（缺必需字段），调用方负责跳过。
 */
export declare function convertAgentDefinitionToProductAgent(name: string, def: ExternalAgentDefinition, sourceTag: string, logger: Logger): Agent | undefined;
/**
 * Build a system-prompt override for the default agent. Cast to ``Agent`` is
 * load-bearing — the merge strategy is SmartMerge (by name), which treats this
 * partial as a patch over the existing default agent rather than a replacement.
 */
export declare function buildSystemPromptAgentOverride(defaultAgentName: string, systemPrompt: string | undefined, appendSystemPrompt: string | undefined): Agent | undefined;
/** Project a parsed local definition into the same input used by query.options.agents. */
export declare function toExternalAgentDefinition(agent: Agent): ExternalAgentDefinition;
export {};
