import type { AgentType } from '@genie/telemetry';
interface PurposeCarrier {
    agentPurpose?: string;
    conversationRequestId?: string;
}
/**
 * Runs an auxiliary model call (title, summary, WebFetch analysis, ...) on a
 * caller-owned Session without writing its purpose / request id onto the shared
 * Session, where a concurrent main run would read and send them as its own.
 */
export declare function runWithAgentPurpose<T>(session: object, purpose: string, callback: () => T, options?: {
    conversationRequestId?: string;
}): T;
/** True when the current async chain is an auxiliary call scoped to `session`. */
export declare function isInAgentPurposeScope(session: object | undefined): boolean;
/** Purpose of the model call running in the current async chain. */
export declare function getEffectiveAgentPurpose(session: PurposeCarrier | undefined): string | undefined;
/** Request id of the model call running in the current async chain. */
export declare function getEffectiveConversationRequestId(session: PurposeCarrier | undefined): string | undefined;
/** Purposes whose model calls are steps of a Session's own agent loop. */
export declare function isMainConversationPurpose(purpose: string | undefined): boolean;
/** True when the model call in the current async chain is a step of `session`'s agent loop. */
export declare function isMainLoopModelCall(session: PurposeCarrier | undefined): boolean;
/** True when the model call in the current async chain has an `AUXILIARY_PURPOSES` purpose. */
export declare function isAuxiliaryPurposeCall(session: PurposeCarrier | undefined): boolean;
/**
 * Runs `callback` outside any purpose scope. A run started from a helper call's async
 * chain (e.g. a queued message drained on its agent_end) is a new agent-loop run.
 */
export declare function runOutsideAgentPurposeScope<T>(callback: () => T): T;
export type ModelCallAgentType = AgentType;
/** Role of the Session's own agent loop, for request-level events. */
export declare function resolveSessionAgentType(session: {
    meta?: Record<string, unknown>;
}): 'main' | 'subagent' | 'team';
/**
 * Role of the model call in the current async chain (X-Agent-Type / telemetry
 * `agentType`), mirroring Claude Code's `x-claude-code-request-class`: compaction
 * summaries report `compaction`, other one-shot helpers (title, WebFetch analysis,
 * ...) report `auxiliary`, whatever Session they run on. The specific helper
 * stays in X-Agent-Purpose.
 */
export declare function resolveModelCallAgentType(session: PurposeCarrier & {
    meta?: Record<string, unknown>;
}): ModelCallAgentType;
export {};
//# sourceMappingURL=agent-purpose-scope.d.ts.map