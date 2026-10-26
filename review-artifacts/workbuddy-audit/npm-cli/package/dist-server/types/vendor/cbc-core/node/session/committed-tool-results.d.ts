import type { FunctionCallItem } from '../../../cbc-shared/node/index.js';
import type { Session } from './session-protocol';
/**
 * Results of tool calls whose side effect already committed (e.g. a file write).
 *
 * The SDK stops delivering tool outputs once the run is cancelled, so a tool that
 * finished its write just before or after the cancellation would otherwise be
 * recorded as "Interrupted by user" although the change is on disk (#142914).
 * The host's tool boundary records the result here; the stream delivery of the
 * real `function_call_result` or the cancellation bookkeeping consumes it.
 */
export declare function recordCommittedToolResult(session: Session, callId: string, output: unknown): void;
/** Drops the record once the SDK delivered this call's own result. */
export declare function forgetCommittedToolResult(session: Session, callId: string | undefined): void;
/** Takes the committed output as the model-visible text the SDK would have produced. */
export declare function takeCommittedToolResult(session: Session, callId: string | undefined): string | undefined;
/**
 * Committed calls that are already in history but have no result there.
 *
 * A call executed inside the step that was cancelled is not in the run's
 * `newItems` (a run resumed after approval is), so the bookkeeping cannot find
 * it there; its `function_call` already reached history through the stream.
 */
export declare function committedCallsWithoutResult(session: Session, excludedCallIds: ReadonlySet<string>): FunctionCallItem[];
//# sourceMappingURL=committed-tool-results.d.ts.map