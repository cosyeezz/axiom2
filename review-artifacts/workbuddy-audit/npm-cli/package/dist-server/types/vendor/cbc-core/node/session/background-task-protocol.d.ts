import type { AcpTerminalEndReason } from '../../../cbc-shared/node/index.js';
export interface BackgroundTaskOutputRead {
    /** Absolute character offset requested for this read, clamped to the current output range. */
    fromOffset: number;
    /** Absolute character offset immediately after the returned snapshot. */
    nextOffset: number;
    /** Preserved output for the requested range, including an omission marker when needed. */
    content: string;
    /** Unread characters no longer retained by the bounded buffer. */
    omittedLength: number;
}
/** Output buffer capabilities used by task producers and consumers. */
export interface BackgroundTaskOutputBuffer {
    push(data: string): void;
    toString(withMarker?: boolean): string;
    /** Absolute character offset at the current end of the output stream. */
    getEndOffset(): number;
    /** Read output retained after an absolute character offset. */
    readSince(offset: number): BackgroundTaskOutputRead;
    isEmpty(): boolean;
    getHead(): string;
    getTail(): string;
    getTruncatedBytes(): number;
    getTotalLines(): number;
    clear(): void;
}
export type TerminalEvidence = 'exit-event' | 'liveness-probe' | 'manual-stop';
/** Retention after completion; running tasks never expire because of this TTL. */
export declare const BACKGROUND_TASK_RETENTION_MS: number;
export interface BackgroundTask {
    id: string;
    toolName: string;
    title: string;
    startTime: number;
    endTime?: number;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'killed';
    stdout: BackgroundTaskOutputBuffer;
    stderr: BackgroundTaskOutputBuffer;
    kill: () => Promise<void>;
    /** The producer owns terminal transitions and their side effects; implementations are idempotent. */
    finalize?: (status: 'completed' | 'failed' | 'killed', evidence: TerminalEvidence, options?: {
        exitStatusUnknown?: boolean;
    }) => Promise<void>;
    probeTerminated?: () => boolean;
    stopRequested?: boolean;
    terminalEvidence?: TerminalEvidence;
    exitStatusUnknown?: boolean;
    notified?: boolean;
    /** TaskOutput returned a terminal snapshot; a pending completion notification is now redundant. */
    resultConsumed?: boolean;
    endReason?: AcpTerminalEndReason;
    deferNotificationDrain?: boolean;
    exitCode?: number | null;
    description?: string;
    prompt?: string;
    response?: string;
    agentType?: string;
    sessionId?: string;
    result?: string;
    error?: string;
    abortController?: AbortController;
    outputFilePath?: string;
    outputStderrPath?: string;
    toolUseId?: string;
    terminalId?: string;
    /** Shell 任务进入后台的原因，仅用于可选展示，不改变生命周期。 */
    backgroundReason?: 'timeout' | 'assistant-budget' | 'internal-abort' | 'explicit' | 'ctrl-b';
    usage?: {
        totalTokens: number;
        toolUses: number;
        durationMs?: number;
    };
    lastToolName?: string;
    isTeamMember?: boolean;
}
//# sourceMappingURL=background-task-protocol.d.ts.map