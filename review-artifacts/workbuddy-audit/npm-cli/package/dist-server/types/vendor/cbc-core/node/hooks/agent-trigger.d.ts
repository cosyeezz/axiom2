export interface AgentTriggerLike {
    id?: string;
    agentName?: string;
    storeId?: string;
    /** 会话 meta：身份标签要读 agentName / teamContext.memberName，parentSessionId 供子会话判定。 */
    meta?: {
        parentSessionId?: string;
        agentName?: string;
        teamContext?: {
            memberName?: unknown;
        };
    } & Record<string, unknown>;
}
export declare function buildAgentTrigger(session: AgentTriggerLike | undefined | null): {
    agent_id?: string;
    agent_type?: string;
};
/**
 * Resolve the `session_id` to put on a hook payload.
 *
 * Claude Code parity: `session_id` always points at the **main agent's** session,
 * even when the hook fires inside a sub-agent. The sub-agent's own id is exposed
 * separately as `agent_id` (see `buildAgentTrigger`).
 *
 * Sessions started for sub-agents carry `meta.parentSessionId` referring back to
 * the main session; main-thread sessions don't, so we fall back to `session.id`.
 */
export declare function resolveHookSessionId(session: AgentTriggerLike | undefined | null): string | undefined;
//# sourceMappingURL=agent-trigger.d.ts.map