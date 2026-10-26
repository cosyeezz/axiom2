import { type CipherEntry, type SensitiveModelBoundary as SensitiveModelBoundaryInterface, type SensitiveToolCallReviewInputProjection } from './sensitive-content-protocol';
export declare class SensitiveModelBoundaryImpl implements SensitiveModelBoundaryInterface {
    private readonly registry;
    getToolCallReviewInputProjection(sessionId: string, toolCallId: string): SensitiveToolCallReviewInputProjection | undefined;
    protectRequest(request: {
        sessionId: string;
        body: string;
        ciphertexts?: readonly string[];
        entries?: ReadonlyArray<Readonly<CipherEntry>>;
        signal?: AbortSignal;
    }): Promise<string>;
    wrapModel<T>(model: T, sessionId: string, captureReviewInput?: boolean): T;
    private prepareModelRequest;
    private restoreRawModelStreamEvent;
    private restoreStructured;
    private restoreText;
    private withProtectionMetadata;
    private register;
    private captureToolCallReviewInput;
    private entries;
    private prune;
}
