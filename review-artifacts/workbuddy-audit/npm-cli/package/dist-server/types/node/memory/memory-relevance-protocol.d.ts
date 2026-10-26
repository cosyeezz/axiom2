import type { Session } from '../../vendor/cbc-core/node/index.js';
export declare const MemoryRelevanceService: unique symbol;
/**
 * 相关记忆信息
 */
export interface RelevantMemory {
    /** 绝对文件路径 */
    path: string;
    /** 修改时间戳 (ms) */
    mtimeMs: number;
}
/**
 * 记忆相关性选择服务
 *
 * 使用 AI 模型从记忆目录中选择与当前查询最相关的记忆（最多 5 个）。
 * 参考 Claude Code 的 findRelevantMemories 实现。
 */
export interface MemoryRelevanceService {
    /**
     * 选择与查询相关的记忆
     *
     * @param query 用户查询
     * @param memoryDir 记忆目录路径
     * @param recentTools 最近使用的工具名称列表
     * @param alreadySurfaced 已经展示过的记忆路径集合
     * @param signal 中断信号
     * @param parentSession 触发本次选择的会话。实现会新建一个临时 session 作为
     *                      runOneTime 的 context，该临时 session 不走 AgentService
     *                      「从当前会话继承」分支，必须由调用方显式传入父会话才能
     *                      继承会话级隐私锁定位（X-Private-Data）。
     * @returns 相关记忆列表（最多 5 个）
     */
    selectRelevantMemories(query: string, memoryDir: string, recentTools?: readonly string[], alreadySurfaced?: ReadonlySet<string>, signal?: AbortSignal, parentSession?: Session): Promise<RelevantMemory[]>;
    /**
     * 检查功能是否启用
     */
    isEnabled(): Promise<boolean>;
}
