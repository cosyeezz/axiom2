import { AgentInputItemProcessor, AgentInputItemProcessorPriority, type Session } from '../../vendor/cbc-core/node/index.js';
import type { AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
import { type CipherEntry, type SensitiveUserInputReview as SensitiveUserInputReviewInterface, type SensitiveUserInputReviewDecision } from './sensitive-content-protocol';
/**
 * Carry an already-completed current-input approval to the history admission point and project
 * protected plaintext immediately. The same item is consumed by the SDK runner before addHistory,
 * so delaying replacement until persistence would leave the current turn plaintext in the first
 * model request. ACP has already published the user-visible plaintext optimistically; replay later
 * restores user history locally from this ciphertext-backed projection.
 */
export declare function markSensitiveUserInputReviewed(item: AgentInputItem, decision: Extract<SensitiveUserInputReviewDecision, {
    kind: 'allow';
}>): void;
/** Clone an optimistically published user item before history admission mutates its projection. */
export declare function cloneForSensitiveHistoryAdmission(item: AgentInputItem): AgentInputItem;
/**
 * Final admission processor for history-backed model input.
 *
 * FunctionCallResult normalization runs first. This processor then protects the canonical Tool/MCP
 * result fields before the item enters session.history or JSONL. It also consumes the current user
 * approval prepared by ACP/the generic run interceptor, with a direct-addHistory fallback.
 */
export declare class SensitiveHistoryAdmissionProcessor implements AgentInputItemProcessor {
    priority: AgentInputItemProcessorPriority;
    protected readonly review: SensitiveUserInputReviewInterface;
    private readonly pendingRuntimeCalls;
    process(item: AgentInputItem, session: Session): Promise<void>;
    private protectRuntimeSuppliedValues;
    private finalizeRuntimeToolResult;
}
/**
 * Project admitted Tool/MCP results onto the provider request copy.
 *
 * The OpenAI Agents streaming loop owns a detached copy of tool results, so mutating the item
 * received by SessionManager is not sufficient by itself. This call-id projection is applied at
 * the final model transport boundary after history admission has completed. It performs no rule
 * detection: only already-approved cipher mappings or explicit withhold decisions are replayed.
 */
export declare function projectSensitiveToolResultsForModel<T>(session: Session, source: T): {
    value: T;
    entries: CipherEntry[];
};
