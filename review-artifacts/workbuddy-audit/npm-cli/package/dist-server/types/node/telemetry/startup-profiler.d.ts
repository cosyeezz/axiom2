import { StartupPhase, StartupProfiler, StartupProfileReport } from './startup-profiler-protocol';
declare global {
    var __CODEBUDDY_PROCESS_START_TIME__: number | undefined;
}
export declare class StartupProfilerImpl implements StartupProfiler {
    private phases;
    private phaseOrder;
    private enabled;
    private uiReadyTime;
    constructor();
    init(): void;
    isEnabled(): boolean;
    markStart(phase: StartupPhase | string, label?: string, metadata?: Record<string, unknown>): void;
    markEnd(phase: StartupPhase | string, metadata?: Record<string, unknown>): void;
    markEvent(phase: StartupPhase | string, label?: string, metadata?: Record<string, unknown>): void;
    markUIReady(): void;
    getUIReadyTime(): number | undefined;
    measure<T>(phase: StartupPhase | string, label: string, fn: () => Promise<T>): Promise<T>;
    getTotalDuration(): number;
    getReport(): StartupProfileReport;
    formatReport(options?: {
        showAll?: boolean;
        threshold?: number;
    }): string;
    private formatDuration;
    private createProgressBar;
    private getPhaseLabel;
}
/**
 * 获取进程启动时间（用于在模块加载阶段记录）
 */
export declare function getProcessStartTime(): number;
