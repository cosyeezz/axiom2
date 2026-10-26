export {};
declare global {
    interface StartupTraceRecorder {
        epoch: number;
        bundle: string;
        isRecording(): boolean;
        begin(phase: string, label?: string): number | undefined;
        end(id: number | undefined, status?: 'complete' | 'error'): void;
        labelCurrentSpan(phase: string, label: string): void;
        markStart(phase: string, label?: string): void;
        markEnd(phase: string): void;
        markEvent(phase: string, label?: string): void;
        measure<T>(phase: string, label: string, fn: () => T): T;
        finish(reason: string, exitCode?: number): void;
        report(): {
            durationMs: number;
            spans: Array<{
                phase: string;
                label: string;
                startMs: number;
                endMs: number;
                durationMs: number;
                status: string;
            }>;
        };
    }
    var __CODEBUDDY_STARTUP_PROFILER__: StartupTraceRecorder | undefined;
}
