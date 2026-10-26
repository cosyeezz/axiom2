/** 文件回退 sidecar 后缀；使用 ndjson 避免被 SessionStore 的 *.jsonl 扫描识别为会话。 */
export declare const FILE_ROLLBACK_SIDECAR_SUFFIX = ".file-rollback.ndjson";
/**
 * 根据 session history 文件计算对应的文件回退 sidecar 路径。
 *
 * 该函数同时供记录存储和 SessionStore 删除流程使用，避免两处自行拼接路径后产生漂移。
 */
export declare function getFileBackupRecordPath(sessionFilePath: string): string;
//# sourceMappingURL=file-backup-record-path.d.ts.map