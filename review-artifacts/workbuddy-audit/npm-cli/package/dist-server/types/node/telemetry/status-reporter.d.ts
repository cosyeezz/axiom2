import { Application, ApplicationLifecycle, IntervalTimer } from '@celljs/core';
import { AuthenticationManager } from '@genie/authentication';
import { ProductManager } from '@genie/product';
import { EventService, Logger, PluginStatusTelemetry } from '@genie/telemetry';
import { type IPrewarmStateService } from '../prewarm/prewarm-protocol';
interface PluginStatusDailyState {
    version: 1;
    reports: Record<string, string>;
}
export declare class PluginStatusServiceImpl implements ApplicationLifecycle<Application> {
    protected readonly productManager: ProductManager;
    protected readonly logger: Logger;
    protected readonly eventService: EventService;
    protected readonly authenticationManager: AuthenticationManager;
    protected readonly prewarmState: IPrewarmStateService;
    protected readonly timer: IntervalTimer;
    protected pluginStartReportPending: boolean;
    protected readonly checkInterval: number;
    private stopped;
    private activationDeferred;
    private cancelAuthWait?;
    initialize(): void;
    protected init(): void;
    protected doInit(): void;
    onStop(): void;
    protected startPeriodicChecking(): Promise<void>;
    protected reportPluginStatusOnStart(): void;
    protected doReportPluginStatusOnStart(): Promise<void>;
    protected waitAuthReadyForPluginStart(): Promise<void>;
    protected delay(ms: number): Promise<void>;
    protected checkAndReportDaily(): Promise<void>;
    protected reportOncePerAccountPerDay(payload: PluginStatusTelemetry): Promise<boolean>;
    protected getAccountUid(): string | undefined;
    protected getLocalDateKey(date?: Date): string;
    protected getDailyReportStatePath(): string;
    protected readDailyReportState(): Promise<PluginStatusDailyState>;
    protected writeDailyReportState(state: PluginStatusDailyState): Promise<void>;
}
export {};
