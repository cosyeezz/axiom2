import { type Session, SessionImageStorage, SessionRestoreHost, SessionStoragePaths, SessionToolOutputStorage } from '../../vendor/cbc-core/node/index.js';
import { ImageBlobService, ToolResultBlobService } from '../blob-store';
export declare class SessionStoragePathsAdapter implements SessionStoragePaths {
    getHomeProjectDir(): string;
    getHomeProjectsDir(): string;
    getWorkDir(): string;
    compressPath(path: string): string;
    canonicalizeStorePath(path: string): string;
}
export declare class SessionImageStorageAdapter implements SessionImageStorage {
    protected readonly blobs: ImageBlobService;
    get processingErrorPlaceholder(): string;
    isInvalidImageDataError(error: unknown): boolean;
    storeFromDataUri(uri: string, source?: string, originalFilename?: string): Promise<unknown>;
}
export declare class SessionToolOutputStorageAdapter implements SessionToolOutputStorage {
    protected readonly blobs: ToolResultBlobService;
    shouldExternalize(output: string): boolean;
    externalize(callId: string, output: string, storeId: string, parentSessionId?: string): Promise<string>;
}
export declare class SessionRestoreHostAdapter implements SessionRestoreHost {
    restore(session: Session): void;
}
