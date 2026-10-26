export declare function runWithAgentRunSignal<T>(session: object, signal: AbortSignal, callback: () => T): T;
export declare function getAgentRunSignal(session: {
    abortSignal?: AbortSignal;
} | undefined): AbortSignal | undefined;
//# sourceMappingURL=agent-run-signal.d.ts.map