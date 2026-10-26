import { Context, Effect, Layer } from 'effect';
import { type FileBackupRecordStoreImpl } from '../../file-rollback/file-backup-record-store';
import { type FileRollbackOperationLockImpl } from '../../../vendor/cbc-core/node/index.js';
declare const FileBackupRecordStoreImplKey_base: Context.ServiceClass<FileBackupRecordStoreImplKey, "server/native/FileBackupRecordStoreImpl", FileBackupRecordStoreImpl>;
export declare class FileBackupRecordStoreImplKey extends FileBackupRecordStoreImplKey_base {
}
export declare const FileBackupRecordStoreImplLayer: Layer.Layer<FileBackupRecordStoreImplKey, never, never>;
declare const FileRollbackOperationLockImplKey_base: Context.ServiceClass<FileRollbackOperationLockImplKey, "server/native/FileRollbackOperationLockImpl", FileRollbackOperationLockImpl>;
export declare class FileRollbackOperationLockImplKey extends FileRollbackOperationLockImplKey_base {
}
export declare const FileRollbackOperationLockImplLayer: Layer.Layer<FileRollbackOperationLockImplKey, never, never>;
export declare const layer: Layer.Layer<FileBackupRecordStoreImplKey | FileRollbackOperationLockImplKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof FileBackupRecordStoreImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof FileRollbackOperationLockImplKey;
    mode: "rebind";
})[];
export declare const warmup: Effect.Effect<void, never, FileBackupRecordStoreImplKey | FileRollbackOperationLockImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
