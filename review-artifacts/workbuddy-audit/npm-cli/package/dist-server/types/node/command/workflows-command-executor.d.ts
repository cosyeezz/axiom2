/**
 * /workflows —— 列出所有 saved + builtin workflow,以及当前 session 内运行中的 workflow run。
 *
 * 单一职责:把 WorkflowManager.listActive() + WorkflowRegistry.list() 拼成
 * markdown 字符串,通过标准 finalize 路径写入 session 历史。
 *
 * Batch 4 简化:不实现交互式键位(`s/p/r/x/j/k`),只输出文本列表。
 * 后续 UI batch 接入 Ink 组件后再补。
 */
import { Logger } from '@genie/telemetry';
import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import type { WorkflowManager, WorkflowRegistry } from '@genie/cbc-workflow';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class WorkflowsCommandExecutor implements CommandExecutor {
    name: string;
    autoGenerateHistory: boolean;
    protected readonly logger: Logger;
    protected readonly sessionManager: SessionManager;
    protected readonly manager: WorkflowManager;
    protected readonly registry: WorkflowRegistry;
    execute(ctx: CommandExecuteContext): Promise<void>;
    private buildOutput;
    private renderRunningSection;
    private renderSavedSection;
    private appendHistory;
}
