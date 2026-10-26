import type { AgentInputItem, FileHistorySnapshotItem } from '../../../cbc-shared/node/index.js';
type SnapshotTable = Record<string, unknown>;
export declare function isFileHistorySnapshotRecord(item: unknown): item is FileHistorySnapshotItem;
/**
 * 跟踪表的内容哈希：按键排序，逐条 `JSON(key) + ':' + 稳定序列化(条目) + '\n'` 做 sha256，取前
 * 16 个十六进制字符。增量格式的 `snapshotBaseHash` / `snapshotHash` 都用它。
 */
export declare function hashSnapshotTable(table: SnapshotTable): string;
/** 快照的落盘身份：关联消息 + isSnapshotUpdate + 跟踪表（不含时间戳），写侧据此去重。 */
export declare function fileHistorySnapshotIdentity(item: FileHistorySnapshotItem): string;
export interface ExpandedSnapshots {
    /** 快照已展开为完整表、冗余 seal 已剔除的 history（非快照条目原样保留、顺序不变）。 */
    readonly history: AgentInputItem[];
    /** 是否出现过增量记录。 */
    readonly hasDelta: boolean;
    /** 找不到基表、只能叠加到前一条快照上的增量记录数。 */
    readonly unresolved: number;
    /** 展开后的完整表，按内容哈希索引（供窗口外基表兜底）。 */
    readonly tables: ReadonlyMap<string, SnapshotTable>;
}
/**
 * 把按文件顺序读出的条目中的增量快照展开为完整跟踪表。全是完整记录时原样返回（同一批对象）。
 * `baseTables` 用于基表落在读取窗口之外的情况（由调用方从整个文件收集）。
 */
export declare function expandPersistedSnapshots(items: readonly AgentInputItem[], baseTables?: ReadonlyMap<string, SnapshotTable>): ExpandedSnapshots;
/** 展开并收集全部完整表（含没有增量时），供基表在读取窗口之外时兜底。 */
export declare function collectSnapshotTables(items: readonly AgentInputItem[]): ReadonlyMap<string, SnapshotTable>;
export {};
//# sourceMappingURL=file-history-snapshot-codec.d.ts.map