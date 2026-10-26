import { Session } from '../../vendor/cbc-core/node/index.js';
import { BehaviorSubject } from 'rxjs';
export declare const PromptSuggestionService: unique symbol;
/**
 * Prompt 建议状态
 */
export interface SuggestionState {
    /** 建议文本 */
    text: string;
    /** 生成时间戳 */
    timestamp: number;
}
/**
 * Prompt Suggestion 服务接口
 *
 * 在 Agent 完成对话后，自动预测用户下一步可能的操作，
 * 并以灰色文本形式显示在输入区域。
 */
export interface PromptSuggestionService {
    /** 当前建议状态的 Subject */
    readonly suggestionSubject: BehaviorSubject<SuggestionState | undefined>;
    /**
     * 根据当前会话生成建议（异步，不阻塞）
     * @param session 当前会话
     */
    generateSuggestionAsync(session: Session): void;
    /**
     * 根据当前会话生成建议并返回文本
     * @param session 当前会话
     * @returns 建议文本，如果生成失败或功能未启用则返回 undefined
     */
    generateSuggestionText(session: Session): Promise<string | undefined>;
    /** Publish an explicit suggestion through the same TUI/ACP channel as generated suggestions. */
    publishSuggestion(session: Session, text: string): void;
    /** 清除当前建议并取消进行中的请求 */
    clearSuggestion(): void;
    /**
     * 检查功能是否启用
     * @returns 是否启用
     */
    isEnabled(): Promise<boolean>;
}
