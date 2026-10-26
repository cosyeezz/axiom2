import type { SessionNotification } from '@agentclientprotocol/sdk';
import { type Session, type SubagentEventReference, type SubagentLifecycleSnapshot } from '../../../../vendor/cbc-core/node/index.js';
import type { AgentInputItem } from '../../../../vendor/cbc-shared/node/index.js';
/**
 * Single ACP extension seam for child-agent identity, lineage and lifecycle.
 *
 * Child output remains ordinary ACP `session/update`; this metadata lets a
 * protocol host project those updates into a child-agent resource without
 * depending on process IDs, AgentTask IDs, or the legacy Agent Teams payloads.
 */
export declare const ACP_SUBAGENT_META_KEY = "codebuddy.ai/subagent";
export type AcpSubagentMeta = SubagentEventReference | SubagentLifecycleSnapshot;
export type AcpSubagentReplayEntry = {
    type: 'item';
    item: AgentInputItem;
    subagent?: SubagentEventReference;
    conversationRequestId?: string;
    rootRequestId?: string;
} | {
    type: 'status';
    subagent: SubagentLifecycleSnapshot;
    timestamp: number;
};
export interface AcpSubagentReplayLogger {
    warn?: (message: string) => void;
}
export declare class AcpSubagentReplayError extends Error {
    constructor(message: string);
}
export type LoadSubagentSession = (sessionId: string) => Promise<Session | undefined>;
/**
 * Expand the durable `ToolResult.subAgent` links into the same ordering used by
 * live AgentTask forwarding:
 *
 * parent Agent tool_call → child status(running) → child updates →
 * child terminal status → parent tool_call_update.
 */
export declare function expandAcpSubagentReplayEntries(items: readonly AgentInputItem[], rootSessionId: string, loadSubagentSession?: LoadSubagentSession, logger?: AcpSubagentReplayLogger): Promise<AcpSubagentReplayEntry[]>;
export declare function withAcpSubagentMeta(update: SessionNotification['update'], subagent: AcpSubagentMeta | undefined): SessionNotification['update'];
export declare function createAcpSubagentStatusUpdate(subagent: SubagentLifecycleSnapshot): SessionNotification['update'];
