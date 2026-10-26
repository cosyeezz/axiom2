/**
 * types/events/tool.ts — the upstream shapes of `tool.*`, re-exported from the
 * vendored declarations (`../claude-code`, Claude Code's own). Do not redefine
 * an upstream shape here: re-run `scripts/sync-claude-code-types.mjs`.
 */
import type { OpValueOf, ToolCallInput } from '../claude-code';
export type { BuiltinToolCallInput, BuiltinToolCallInputFallback, BuiltinToolInputs, BuiltinToolName, BuiltinToolResults, McpToolCallInput, ToolCallArgs, ToolCallEnvelope, ToolCallInput, ToolCallOverloads, ToolCallReserved, ToolCallResult, ToolCheckArgs, ToolCheckDecision, ToolCheckInput, ToolCheckResult, ToolDeferral, ToolDescribeInput, ToolDescribeResult, ToolEnvelope, ToolInfo, ToolInputOf, ToolNamed, ToolResultOf, ToolResultSummary, ToolSpec, ToolUseSummary, } from '../claude-code';
/** What `$.tool.register` resolves to: the registered name. */
export type ToolRegisterResult = OpValueOf['tool.register'];
/**
 * Loop identity carried on every `tool.call` event: which agent's loop the
 * call happened in (undefined on the main loop).
 */
export type ToolAgentLoop = Pick<ToolCallInput, 'agentId'>;
//# sourceMappingURL=tool.d.ts.map