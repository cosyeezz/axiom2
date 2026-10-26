/**
 * Memory Extraction Service — 与 Claude Code extractMemories.ts 对齐
 *
 * 对话结束后，自动从对话中提取值得记住的信息并保存到记忆目录。
 * 使用 PromptSuggestionService 的架构模式（复用 RunState + RunnerProvider）。
 *
 * 触发方式：通过 MemoryExtractionStopHook 在 HookEvent.STOP 时 fire-and-forget。
 */
import { RunnerProvider, Session, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { SettingsManager } from '../settings';
export declare const MemoryExtractionService: unique symbol;
export interface MemoryExtractionService {
    /**
     * 异步触发记忆提取（不阻塞）
     */
    extractAsync(session: Session): void;
    /**
     * 等待提取完成（headless 模式下使用）
     */
    waitForExtraction(): Promise<void>;
    /**
     * 检查功能是否启用
     */
    isEnabled(): Promise<boolean>;
}
export declare class MemoryExtractionServiceImpl implements MemoryExtractionService {
    protected readonly runnerProvider: RunnerProvider;
    protected readonly sessionManager: SessionManager;
    protected readonly settingsManager: SettingsManager;
    protected readonly logger: Logger;
    /** 是否正在提取 — 防止并发 */
    private inProgress;
    /** 上一次提取处理到的消息 UUID */
    private lastMemoryMessageUuid?;
    protected init(): void;
    isEnabled(): Promise<boolean>;
    /** 最近一次提取的 Promise，用于 headless 模式等待完成 */
    private lastExtractionPromise?;
    extractAsync(session: Session): void;
    /** 等待提取完成（headless 模式下使用） */
    waitForExtraction(): Promise<void>;
    private doExtract;
    /**
     * 计算自上次提取以来的新消息数量
     */
    private countNewMessages;
    /**
     * 检查主 agent 是否已写入记忆文件
     */
    private hasMemoryWritesSince;
    /**
     * 推进 cursor 到最新消息
     */
    private advanceCursor;
}
