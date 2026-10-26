import type { TrackedFileBackup } from '../agent/custom-input-item-types';
/** Checkpoint 广播事件类型 */
export type CheckpointBroadcastEvent = 'created' | 'updated' | 'reverted';
/** Checkpoint 文件变更类型 */
export type FileChangeType = 'created' | 'modified' | 'deleted';
/**
 * Checkpoint 广播中的单个文件变更信息。
 * additions/deletions/diff 仅在支持 detailedCheckpoint 的客户端上提供。
 */
export interface CheckpointBroadcastFile {
    uri: string;
    changeType: FileChangeType;
    /** 新增行数 */
    additions?: number;
    /** 删除行数 */
    deletions?: number;
    /** Unified diff 格式内容 */
    diff?: string;
    /** 超时缺省的 diff/统计不能被解释为无变更。 */
    diffStatus?: 'timeout';
}
/** Checkpoint 广播信息（客户端接收的数据结构） */
export interface CheckpointBroadcastInfo {
    id: string;
    createdAt: number;
    label?: string;
    revertedAt?: number;
    fileChanges: {
        files: CheckpointBroadcastFile[];
        totalAdditions: number;
        totalDeletions: number;
    };
}
/** 回退操作作用域 */
export type RevertScope = 'Code' | 'Conversation' | 'CodeAndConversation';
/** 文件版本信息(扩展 TrackedFileBackup,添加文件路径) */
export interface FileVersion extends TrackedFileBackup {
    /** 文件绝对路径 */
    filePath: string;
    /** 备份文件的完整路径 (hook 用户可直接读取原始内容) */
    backupFilePath?: string;
}
/** Checkpoint 数据结构 */
export interface Checkpoint {
    id?: string;
    parentId?: string;
    logicalParentId?: string;
    label?: string;
    createdAt?: number;
    /** 当前轮次的文件修改统计 */
    fileChangeStats?: CheckpointFileChangeStats;
    /** 文件快照映射 (key: 文件路径, value: 文件版本信息) */
    fileSnapshots: Record<string, FileVersion>;
    /** 触发此 checkpoint 的工具名称 (实时模式下设置) */
    triggerTool?: string;
    /** 触发此 checkpoint 的文件路径 (实时模式下设置) */
    triggerFile?: string;
}
/** 文件修改统计 */
export interface CheckpointFileChangeStats {
    /** 修改的文件路径列表 */
    files: string[];
    /** 新增行数 */
    additions: number;
    /** 删除行数 */
    deletions: number;
    /**
     * 行数为近似值（PTC/Code Mode 兜底：files 来自本轮 trackFile 快照，additions/deletions
     * 暂记 0）。需要精确行数的调用方（如 TUI rewind 面板）据此异步调用
     * compareWithCurrentFiles 补齐后清除本标记。仅内存态，不持久化。
     */
    approximate?: boolean;
}
//# sourceMappingURL=checkpoint-types.d.ts.map