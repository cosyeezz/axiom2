import { HookEvent, HookExecutionResult } from '../../../vendor/cbc-shared/node/index.js';
import { Logger, TraceService } from '@genie/telemetry';
import { AskService } from '../../ask/ask-protoctol';
import { type GalileoSessionBridge as GalileoSessionBridgeApi } from '../../galileo/galileo-session-bridge-protocol';
import { Hook, HookInput, HookPriority } from '../../hooks/hook-protocol';
/** SessionManager 看到此标记后不再补发 request 终态，避免和关 span 前的上报重复。 */
export declare const GALILEO_REQUEST_TERMINAL_REPORTED = "galileoRequestTerminalReported";
/**
 * Trace Stop Hook
 *
 * Runs on Stop to close the root trace span and flush all pending trace data.
 *
 * Lifecycle: one trace per conversation turn (UserPromptSubmit → Stop).
 * Handles:
 * - Success: markAsSuccessful
 * - Cancel (user abort): markAsFailed + conversation.cancelled = true
 * - Also cleans up any orphaned tool spans
 */
export declare class TraceStopHook implements Hook {
    readonly event = HookEvent.STOP;
    readonly priority = HookPriority.High;
    protected readonly logger: Logger;
    protected readonly traceService: TraceService;
    protected readonly askService: AskService;
    protected readonly galileoSessionBridge?: GalileoSessionBridgeApi;
    private _flags?;
    private get flags();
    execute(input: HookInput): Promise<HookExecutionResult | undefined>;
    /**
     * 在 root span 仍然打开时写下 request 终态。用户取消不上报。
     * 自动重试不会走到 Stop hook，仍由 SessionManager 的 isAutoRetryError 跳过。
     */
    private emitRequestDetailBeforeSpanClose;
}
