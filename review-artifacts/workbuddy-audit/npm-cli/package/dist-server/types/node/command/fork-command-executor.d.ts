import { SessionHookManager, SessionManager, SessionStore } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
/**
 * /fork 命令执行器
 *
 * 在当前对话位置创建一个分支，复制活跃对话历史到新 session 并自动切换。
 * 参考 Claude Code 的 /branch 命令实现。
 */
export declare class ForkCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly sessionManager: SessionManager;
    protected readonly sessionStore: SessionStore;
    protected readonly sessionHookManager: SessionHookManager;
    protected readonly logger: Logger;
    execute(ctx: CommandExecuteContext): Promise<void>;
    /**
     * 通知 ACP 客户端 session 已切换
     */
    private notifySessionReset;
}
/**
 * /branch 命令执行器，与 /fork 功能完全相同
 */
export declare class BranchCommandExecutor extends ForkCommandExecutor {
    name: string;
}
