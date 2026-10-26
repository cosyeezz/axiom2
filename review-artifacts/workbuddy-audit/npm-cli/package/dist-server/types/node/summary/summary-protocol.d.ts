import { Session } from '../../vendor/cbc-core/node/index.js';
export declare const SessionSummaryService: unique symbol;
/**
 * Summary 生成结果
 */
export interface SummaryGenerationResult {
    /**
     * 生成的摘要内容
     */
    summary: string;
}
/**
 * Session Summary 服务接口
 * 负责生成和管理会话摘要
 */
export interface SessionSummaryService {
    /**
     * 主 Agent 完成一轮回复后按 3/6/9/12 阶梯策略更新摘要。
     */
    handleAgentEnd(session: Session): Promise<boolean>;
    /**
     * 上下文压缩前强制刷新摘要。
     */
    handlePreCompact(session: Session): Promise<boolean>;
    /**
     * 分析会话并生成摘要（手动/兼容入口）
     * @param session 当前会话
     * @returns 是否成功生成摘要
     */
    analyzeAndUpdate(session: Session): Promise<boolean>;
    /**
     * 检查是否应该生成摘要
     * @param session 当前会话
     * @returns 是否应该生成
     */
    shouldGenerate(session: Session): boolean;
    /**
     * 设置强制启用（用于非交互模式通过参数开启）
     */
    setForceEnabled(enabled: boolean): void;
    /**
     * 检查功能是否禁用
     */
    get disabled(): boolean;
}
