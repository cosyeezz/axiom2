/**
 * Memory Relevance Service — 使用 AI 语义匹配选择相关记忆
 *
 * 通过 memorySelector agent（product.json 配置，lite 模型）进行语义筛选：
 * - 轻量单次调用，不需要对话历史
 * - 返回最多 5 个相关记忆
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { SettingsManager } from '../settings';
import { MemoryRelevanceService, RelevantMemory } from './memory-relevance-protocol';
export declare class MemoryRelevanceServiceImpl implements MemoryRelevanceService {
    protected readonly settingsManager: SettingsManager;
    protected readonly sessionManager: SessionManager;
    protected readonly logger: Logger;
    protected init(): void;
    isEnabled(): Promise<boolean>;
    selectRelevantMemories(query: string, memoryDir: string, recentTools?: readonly string[], alreadySurfaced?: ReadonlySet<string>, signal?: AbortSignal, parentSession?: Session): Promise<RelevantMemory[]>;
    /**
     * 使用 memorySelector agent 进行 AI 语义匹配
     *
     * agent 在 product.json 中注册（instructions 引用 memory-selector-instructions 模板），
     * 通过 agentService.runOneTime 调用，和 terminalTitleGenerator 等 agent 一致。
     *
     * ESC 取消支持：由于 runOneTime 会创建自己的 abortController 覆盖 options.signal，
     * 外部 signal 无法直接中断内部的 runner.run。这里显式创建一个 ephemeral session
     * 并桥接外部 signal 到它的 abortController，使主会话 ESC 能中断 memorySelector。
     */
    private doAISelection;
}
