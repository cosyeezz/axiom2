import type { Session } from './session-protocol';
export declare const SessionStoragePaths: unique symbol;
export interface SessionStoragePaths {
    getHomeProjectDir(): string;
    getHomeProjectsDir(): string;
    getWorkDir(): string;
    compressPath(path: string): string;
    canonicalizeStorePath(path: string): string;
}
export declare const SessionImageStorage: unique symbol;
export interface SessionImageStorage {
    storeFromDataUri(uri: string, source?: string, originalFilename?: string): Promise<unknown>;
    isInvalidImageDataError(error: unknown): boolean;
    readonly processingErrorPlaceholder: string;
}
export declare const SessionToolOutputStorage: unique symbol;
export interface SessionToolOutputStorage {
    shouldExternalize(output: string): boolean;
    externalize(callId: string, output: string, storeId: string, parentSessionId?: string): Promise<string>;
}
export declare const SessionRestoreHost: unique symbol;
export interface SessionRestoreHost {
    restore(session: Session): void;
}
//# sourceMappingURL=session-store-host-protocol.d.ts.map