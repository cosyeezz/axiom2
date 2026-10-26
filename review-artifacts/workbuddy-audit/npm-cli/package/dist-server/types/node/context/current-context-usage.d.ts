import { Session } from '../../vendor/cbc-core/node/index.js';
export interface CurrentContextUsage {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    totalInputTokens: number;
}
/**
 * 将最新一次 provider usage 归一化为 Claude Code statusline 的互斥字段口径。
 * `/context` 与自定义状态栏共用此入口，避免两处上下文百分比再次分叉。
 */
export declare function getCurrentContextUsage(session: Session): CurrentContextUsage | undefined;
