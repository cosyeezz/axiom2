import { type FileBlockRecord } from '../sandbox-cli/sandbox-cli-protocol';
export interface ProgramBlacklistRecordPartition {
    blockedProgramRecords: FileBlockRecord[];
    otherFileRecords: FileBlockRecord[];
}
/** 把程序黑名单记录从普通文件拦截中分离，避免重复或误导性展示。 */
export declare function partitionProgramBlacklistRecords(records: FileBlockRecord[] | undefined): ProgramBlacklistRecordPartition;
/** 将程序黑名单命中转换为模型可理解且不可申请文件授权的明确说明。 */
export declare function formatProgramBlacklistInterceptMessage(records: FileBlockRecord[] | undefined): string;
