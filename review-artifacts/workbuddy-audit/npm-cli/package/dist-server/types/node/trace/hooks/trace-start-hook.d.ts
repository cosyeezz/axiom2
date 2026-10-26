import { HookEvent, HookExecutionResult } from '../../../vendor/cbc-shared/node/index.js';
import { Logger, TraceService } from '@genie/telemetry';
import { GalileoService } from '../../galileo/galileo-protocol';
import { Hook, HookInput, HookPriority } from '../../hooks/hook-protocol';
export declare class TraceStartHook implements Hook {
    readonly event = HookEvent.USER_PROMPT_SUBMIT;
    readonly priority = HookPriority.High;
    protected readonly logger: Logger;
    protected readonly traceService: TraceService;
    protected readonly galileoService?: GalileoService;
    private _flags?;
    private traceProviderWaitExhausted;
    private traceProviderWarningEmitted;
    private get flags();
    protected isTracingDisabled(): boolean;
    protected isGalileoSdkReady(): boolean;
    protected waitForTraceProviderReady(timeoutMs?: number): Promise<boolean>;
    execute(input: HookInput): Promise<HookExecutionResult | undefined>;
}
