/**
 * types/events/agent.ts — the upstream shapes of `agent.*`, re-exported from the
 * vendored declarations (`../claude-code`, Claude Code's own). Do not redefine
 * an upstream shape here: re-run `scripts/sync-claude-code-types.mjs`.
 */
import type { OpValueOf } from '../claude-code';
export type { AgentCallRecord, AgentInfo, AgentLoop, AgentOfferInput, AgentOfferResult, AgentSpawnArgs, AgentSpawnInput, AgentSpawnResult, AgentSpec, } from '../claude-code';
/**
 * What `$.agent.register` resolves to: the type's fully-qualified name
 * (`<plugin>:<name>`).
 */
export type AgentRegisterResult = OpValueOf['agent.register'];
//# sourceMappingURL=agent.d.ts.map