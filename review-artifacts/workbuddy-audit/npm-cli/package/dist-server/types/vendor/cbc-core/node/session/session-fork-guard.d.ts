export declare class SessionForkGraphError extends Error {
    readonly reason: 'invalid_history' | 'budget_exceeded';
    constructor(message: string, reason?: 'invalid_history' | 'budget_exceeded');
}
//# sourceMappingURL=session-fork-guard.d.ts.map