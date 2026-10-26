import type { RunToolApprovalItem } from '../../vendor/cbc-shared/node/index.js';
import type { AgentJobQuestion } from './agent-view-protocol';
export interface PendingJobInputDetails {
    needs: string;
    block?: {
        questions: AgentJobQuestion[];
    };
    suggestedReply?: string;
}
/**
 * Convert an exact interruption queue item into durable agent-view detail.
 * The job state stores only presentation data; approval authority remains in
 * InterruptionService and users still attach to make the actual decision.
 */
export declare function resolvePendingJobInput(item: RunToolApprovalItem | undefined, fallback: string): PendingJobInputDetails;
