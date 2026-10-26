/** Keep the request's cancellation owner across SDK approval continuations. */
export declare function registerRemoteResultRun(result: object, controller: AbortController, signal: AbortSignal): void;
export declare function remoteRunSignalForState(state: object): AbortSignal | undefined;
/** Abort only the remote result, never the Session's newest (possibly local) run. */
export declare function abortRemoteResultRun(result: object): boolean;
//# sourceMappingURL=remote-result-control.d.ts.map