export interface ModRunDiagnostic {
    phase: 'client-observation';
    code: 'MOD_CLIENT_ACTIVATION_DISCONNECTED' | 'MOD_CLIENT_ACTIVATION_UNCONFIRMED';
}
/** Old persisted receipts remain readable without rewriting user metadata. */
export declare function isModClientObservationFailure(run: {
    status: string;
    error?: string;
    diagnostic?: ModRunDiagnostic;
} | undefined): boolean;
//# sourceMappingURL=mod-run-state.d.ts.map