import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { CheckpointListResponse, CheckpointReadResponse, CheckpointTarget, FileRollbackErrorCode, FileRollbackResult } from './file-rollback-protocol';
/**
 * 文件回退的执行结果（agent-cli 内部协议，不暴露到 ACP wire）。
 *
 * `preRestoreCommitSeqs` 按执行顺序记录 Sandbox 各恢复批次的操作前快照序号，
 * 用于墓碑写入失败时补偿文件到操作前状态。它不应出现在 `RollbackResult`
 * wire 响应里——`handleRollback` 只将 `.files` 填入 wire 的 `result.files`。
 */
export interface FileRollbackExecution {
    files: FileRollbackResult[];
    preRestoreCommitSeqs?: number[];
}
/** request 与 Sandbox 文件备份提交之间的最小持久化记录版本。 */
export declare const FILE_BACKUP_RECORD_VERSION: 1;
/**
 * 单轮文件备份关联记录。
 *
 * 记录按 session 分文件保存，因此无需重复保存 sessionId；文件列表由 Sandbox Query
 * 在读取/执行时提供，不在 agent-cli 侧复制一份。
 */
export interface FileBackupRecord {
    /** JSONL 记录格式版本，便于未来兼容升级。 */
    v: typeof FILE_BACKUP_RECORD_VERSION;
    /** agent-cli 当前对话轮次的真实 request ID。 */
    requestId: string;
    /** Sandbox CommitModifyBackup 返回的提交序号；0 表示该轮没有文件修改。 */
    commitSeq: number;
    /**
     * 备份提交写入时间（ISO 8601），作为 checkpoint 的 `createdAt` 来源。
     *
     * **可选且不补写**：该字段随 ACP checkpoint 协议一起加入，此前已落盘的 JSONL
     * 记录没有它。对老记录返回 `createdAt: undefined` 而不是拿「文件 mtime」或
     * 「当前时间」顶替——那会给用户展示一个假的 checkpoint 时间。
     *
     * 字段名取短名 `ca` 是为了控制 JSONL 体积（长会话下每轮一条）。
     */
    ca?: string;
}
/** request 与文件备份提交的持久化存储。 */
export declare const FileBackupRecordStore: unique symbol;
export interface FileBackupRecordStore {
    /** 追加一条已成功提交的 request→commit 关联。 */
    append(session: Session, record: FileBackupRecord): Promise<void>;
    /** 读取当前 session 的全部有效关联，按写入顺序返回。 */
    list(session: Session): Promise<FileBackupRecord[]>;
}
/**
 * fork 点解析函数 —— 由 ACP 层注入（resolveResendForkPoint，同步纯函数）。
 *
 * 之所以由调用方注入而不是 service 自己做：解析依赖 ACP 层的
 * `resolveResendForkPoint`，service 属于领域层，不应反向依赖协议层。
 */
export type ResolveForkPointForRollback = (session: Session, targetRequestId: string) => Promise<{
    found: boolean;
    forkPoint?: string | undefined;
}>;
/** 文件回退服务（checkpoint 读 + 写的领域实现）。 */
export declare const FileRollbackService: unique symbol;
export interface FileRollbackService {
    /**
     * 列出当前会话可回退的 checkpoint 概要（`checkpoint/list` 的领域实现）。
     *
     * **纯只读**。只返回确实产生过文件备份的轮次——没有备份的轮次回退时不涉及文件，
     * 列出来会让用户以为选它能恢复产物。
     */
    checkpointList(session: Session): Promise<CheckpointListResponse>;
    /**
     * 读一个 checkpoint（`checkpoint/read` 的领域实现）：计算从目标轮次（含）到当前
     * 分支末尾的文件影响，同时解析 fork 点。**纯只读**，不改文件也不动会话指针。
     *
     * `target` 走 messageId / requestId 双键解析（见 `CheckpointTarget`）。
     *
     * fork 解析由调用方注入（`resolveForkPoint`）而不是 service 自己做：
     * 解析依赖 ACP 层的 `resolveResendForkPoint`，service 属于领域层，不应反向依赖协议层。
     */
    checkpointRead(session: Session, target: Omit<CheckpointTarget, 'sessionId'>, resolveForkPoint: ResolveForkPointForRollback): Promise<CheckpointReadResponse>;
    /**
     * 执行整轮文件回退。
     *
     * `target` 走 messageId / requestId 双键解析（与 `checkpointRead` 同一口径），
     * 内部通过 `resolveTargetRequestId` 收敛为 requestId 后执行。
     *
     * 返回 `FileRollbackExecution`：`.files` 是每个文件的最终结果，
     * `.preRestoreCommitSeqs` 是各批次操作前快照序号（补偿用，不暴露到 ACP wire）。
     *
     * @param alreadyLocked 调用方是否已持有 session 级操作锁。
     *   handleRollback 会在自己的锁内调用本方法并传 true —— FileRollbackOperationLockImpl
     *   是 Promise 链锁、**不可重入**，重复获取会确定性死锁。
     */
    rollbackFiles(session: Session, target: Omit<CheckpointTarget, 'sessionId'>, alreadyLocked?: boolean): Promise<FileRollbackExecution>;
    /** 把文件复原到某次回退操作之前的快照（补偿用；调用方须已持锁）。 */
    compensate(session: Session, preRestoreCommitSeqs: readonly number[]): Promise<void>;
}
/**
 * 文件回退与文件备份提交共用的 session 级串行锁。
 *
 * 它避免同一个 session 在 Commit、Query、Restore 之间交错，从而保证执行阶段的
 * "先完整校验、再开始恢复"成立。不同 session 之间仍可并行。
 */
export { FileRollbackOperationLock } from '../../vendor/cbc-core/node/index.js';
/** agent-cli 内部抛出的、可稳定映射到 ACP error.data.code 的文件回退错误。 */
export declare class FileRollbackRequestError extends Error {
    readonly code: FileRollbackErrorCode;
    constructor(code: FileRollbackErrorCode, message: string);
}
/**
 * 写入 Sandbox commitMsg 的稳定标记。
 *
 * Sandbox 在 GC 后重启时可能复用 commitSeq；查询时同时校验此标记，避免把新提交
 * 错认成已被清理的旧提交。该字符串属于 agent-cli 与自身持久化记录之间的内部契约。
 */
export declare function buildFileBackupCommitMessage(requestId: string): string;
