/** 终端结束原因；与可信退出码一起区分正常完成、用户停止和异常终止。 */
export type AcpTerminalEndReason = 'cancelled-by-user' | 'output-limit' | 'interrupted' | 'stopped' | 'sandbox-denied' | 'exit-status-unknown' | 'exited';
/** Execution facts shared by terminal publishers; no transport encoding. */
export type TerminalEndReason = AcpTerminalEndReason;
export interface TerminalEndInfo {
    reason: TerminalEndReason;
    detail?: string;
}
export type TerminalEventData = {
    kind: 'created';
    command: string;
    cwd: string;
} | {
    kind: 'output';
    bytes: Uint8Array;
} | {
    kind: 'exited';
    exitCode?: number | null;
    signal?: string | null;
    end?: TerminalEndInfo;
};
export interface TerminalEvent {
    type: 'terminal';
    data: {
        terminalId: string;
        timestamp: number;
        requestId?: string;
        rootRequestId?: string;
    } & TerminalEventData;
}
//# sourceMappingURL=terminal-types.d.ts.map