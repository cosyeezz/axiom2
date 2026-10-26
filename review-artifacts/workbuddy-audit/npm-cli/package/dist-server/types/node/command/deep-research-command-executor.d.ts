/**
 * /deep-research <question>
 *
 * 单一职责:把 `/deep-research` 命令翻成 `Workflow` 工具调用,启动 builtin "deep-research"
 * workflow 并立刻返回 runId(workflow 在后台跑,通过 /workflows 看进度)。
 *
 * 与 Claude Code 行为对齐:
 *  - 必须有 question 参数
 *  - 启动后只返回 ack;run 注册成 BackgroundTask,完成时把报告写进对话流并推 task-notification
 */
import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { type WorkflowManager } from '@genie/cbc-workflow';
import { Logger } from '@genie/telemetry';
import { WorkflowBackgroundTaskTracker } from '../tools/workflow-background-task';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class DeepResearchCommandExecutor implements CommandExecutor {
    name: string;
    autoGenerateHistory: boolean;
    protected readonly logger: Logger;
    protected readonly sessionManager: SessionManager;
    protected readonly manager: WorkflowManager;
    protected readonly workflowBackgroundTaskTracker: WorkflowBackgroundTaskTracker;
    execute(ctx: CommandExecuteContext): Promise<void>;
    private run;
    private joinArgs;
    private appendHistory;
}
