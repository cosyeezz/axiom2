export declare function markToolCallStartsInInvoke<T extends object>(tool: T): T;
export declare function toolCallStartsInInvoke(tool: unknown): boolean;
/** Dispatch of a marked tool: hold the call's start until its invoke reports it. */
export declare function holdToolCallStart(runContext: object, callId: string, start: () => void): void;
/** Right before the tool runs. The first attempt that runs starts the call; later ones change nothing. */
export declare function reportToolCallStarted(runContext: object, callId: string | undefined): void;
/** The call ended; a call that never ran (denied or cancelled before it) leaves nothing behind. */
export declare function releaseToolCallStart(runContext: object, callId: string): void;
//# sourceMappingURL=tool-call-start.d.ts.map