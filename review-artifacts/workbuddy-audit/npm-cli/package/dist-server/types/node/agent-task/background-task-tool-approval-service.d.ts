import { Session } from '../../vendor/cbc-core/node/index.js';
import { AgentInputItem, RunToolApprovalItem } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { ToolManager } from '../tools';
import { BackgroundTaskToolApprovalService } from './agent-task-protocol';
/**
 * BackgroundTaskToolApprovalServiceImpl
 * 后台任务工具授权服务实现
 *
 * 负责在后台任务 session 中处理工具调用权限。
 * 所有工具调用自动批准，无需用户交互。
 */
export declare class BackgroundTaskToolApprovalServiceImpl implements BackgroundTaskToolApprovalService {
    protected readonly logger: Logger;
    protected readonly toolManager: ToolManager;
    /**
     * 检查 session 是否为后台任务会话
     * 通过检查 session.meta.isBackgroundTaskSession 标记
     */
    isBackgroundTaskSession(session: Session): boolean;
    /**
     * 自动批准后台任务中的工具调用
     * SDK 批准由 core 对准确的来源 RunState 写入；这里只记录策略决定
     */
    approve(item: RunToolApprovalItem, session: Session): void;
    /**
     * 处理后台任务中被拒绝的工具调用
     * 生成工具执行失败结果并返回给 Agent
     */
    handleRejection(item: RunToolApprovalItem, session: Session, reason: string): Promise<AgentInputItem[]>;
    /**
     * 记录权限决策
     * 用于审计和日志追踪
     */
    logApprovalDecision(item: RunToolApprovalItem, session: Session, decision: 'approved' | 'rejected'): void;
}
