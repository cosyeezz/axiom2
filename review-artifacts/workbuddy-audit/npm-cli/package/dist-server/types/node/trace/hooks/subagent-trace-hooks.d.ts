import { Logger, TraceService } from '@genie/telemetry';
import { Hook, HookInput, HookPriority } from '../../hooks/hook-protocol';
import { HookEvent, HookExecutionResult } from '../../../vendor/cbc-shared/node/index.js';
import { SessionManager } from '../../../vendor/cbc-core/node/index.js';
export declare class SubagentTraceStartHook implements Hook {
    readonly event = HookEvent.SUBAGENT_START;
    readonly priority = HookPriority.High;
    protected readonly logger: Logger;
    protected readonly sessionManager: SessionManager;
    protected readonly traceService: TraceService;
    execute(input: HookInput): Promise<HookExecutionResult | undefined>;
}
export declare class SubagentTraceStopHook implements Hook {
    readonly event = HookEvent.SUBAGENT_STOP;
    readonly priority = HookPriority.High;
    protected readonly logger: Logger;
    execute(input: HookInput): Promise<HookExecutionResult | undefined>;
}
