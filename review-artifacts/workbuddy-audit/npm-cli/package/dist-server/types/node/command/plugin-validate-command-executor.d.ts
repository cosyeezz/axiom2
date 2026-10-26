import { Logger } from '@celljs/core';
import { Workspace } from '@genie/runtime';
import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
/**
 * /plugin validate 命令执行器
 * 四层校验插件有效性
 *
 * 参考: Claude Code validatePlugin.ts (400+行)
 */
export declare class PluginValidateCommandExecutor implements CommandExecutor {
    readonly name = "/plugin-validate";
    readonly message = "Validating plugin...";
    readonly autoGenerateHistory = false;
    protected readonly logger: Logger;
    protected readonly sessionManager: SessionManager;
    protected readonly workspace: Workspace;
    protected init(): void;
    execute(ctx: CommandExecuteContext): Promise<void>;
    private findMetadataDir;
}
