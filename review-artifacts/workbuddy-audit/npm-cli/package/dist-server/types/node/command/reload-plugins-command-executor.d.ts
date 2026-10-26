import { Logger } from '@celljs/core';
import { AgentManager, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { PluginManager, PluginRuntimeRefreshService } from '../../vendor/cbc-plugins/node/index.js';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
/**
 * /reload-plugins 命令执行器
 * 重新加载所有插件组件（不需要重启）
 *
 * 参考: Claude Code /reload-plugins 的 refreshActivePlugins 行为
 */
export declare class ReloadPluginsCommandExecutor implements CommandExecutor {
    readonly name = "/reload-plugins";
    readonly message = "Reloading plugins...";
    readonly autoGenerateHistory = false;
    protected readonly logger: Logger;
    protected readonly sessionManager: SessionManager;
    protected readonly pluginManager?: PluginManager;
    protected readonly pluginRuntimeRefreshService?: Pick<PluginRuntimeRefreshService, 'refresh'>;
    protected readonly agentManager?: AgentManager;
    protected init(): void;
    execute(ctx: CommandExecuteContext): Promise<void>;
}
