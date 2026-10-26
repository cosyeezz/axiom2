import { HookEvent, HookExecutionResult } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { Hook, HookInput, HookPriority } from '../hooks/hook-protocol';
import { SessionSummaryService } from './summary-protocol';
export declare class SummaryStopHook implements Hook {
    readonly event = HookEvent.STOP;
    readonly priority = HookPriority.Low;
    protected readonly summaryService: SessionSummaryService;
    protected readonly logger: Logger;
    execute(input: HookInput): Promise<HookExecutionResult | undefined>;
}
export declare class SummaryPreCompactHook implements Hook {
    readonly event = HookEvent.PRE_COMPACT;
    readonly priority = HookPriority.High;
    protected readonly summaryService: SessionSummaryService;
    protected readonly logger: Logger;
    execute(input: HookInput): Promise<HookExecutionResult | undefined>;
}
