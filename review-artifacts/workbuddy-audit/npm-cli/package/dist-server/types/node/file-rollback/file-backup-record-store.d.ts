import { type Session, SessionStore } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { type FileBackupRecord, type FileBackupRecordStore as FileBackupRecordStoreContract } from './file-rollback-service-protocol';
/** 使用独立 JSONL sidecar 保存 request→commit 关联，不污染会话 history。 */
export declare class FileBackupRecordStoreImpl implements FileBackupRecordStoreContract {
    protected readonly logger: Logger;
    protected readonly sessionStore: SessionStore;
    private readonly writeTails;
    append(session: Session, record: FileBackupRecord): Promise<void>;
    list(session: Session): Promise<FileBackupRecord[]>;
    private getFilePath;
    private isRecord;
}
