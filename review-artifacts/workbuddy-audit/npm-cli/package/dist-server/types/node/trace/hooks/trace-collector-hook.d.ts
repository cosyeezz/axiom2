/**
 * Trace Collector Hooks
 *
 * 1. TraceCollectorEnrichHook (USER_PROMPT_SUBMIT, Low)
 *    — enriches active SDK trace with sessionId, agentName, prompt
 *
 * 2. TraceCollectorStopHook (STOP, Low)
 *    — extracts model/token data from session history into trace spans
 */
import { HookEvent, HookExecutionResult } from '../../../vendor/cbc-shared/node/index.js';
import { Hook, HookInput, HookPriority } from '../../hooks/hook-protocol';
export declare class TraceCollectorEnrichHook implements Hook {
    readonly event = HookEvent.USER_PROMPT_SUBMIT;
    readonly priority = HookPriority.Low;
    private readonly collector;
    execute(input: HookInput): Promise<HookExecutionResult | undefined>;
}
/**
 * On STOP, walk session history to extract model/token/usage data
 * and inject it into the corresponding trace's generation spans.
 */
export declare class TraceCollectorStopHook implements Hook {
    readonly event = HookEvent.STOP;
    readonly priority = HookPriority.Low;
    private readonly collector;
    execute(input: HookInput): Promise<HookExecutionResult | undefined>;
}
