import { NavigationManager } from '../navigation';
import { PluginManager } from '../../vendor/cbc-plugins/node/index.js';
import { SessionHookManager, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { PluginTelemetryService } from '../telemetry';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class PluginCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly sessionManager: SessionManager;
    protected readonly pluginManager: PluginManager;
    protected readonly sessionHookManager: SessionHookManager;
    protected readonly navigationManager: NavigationManager;
    protected readonly pluginTelemetryService: PluginTelemetryService;
    execute(ctx: CommandExecuteContext): Promise<void>;
    /**
     * 从参数列表中解析 --scope / -s 值
     */
    private parseScopeFromArgs;
    private mapScope;
    /**
     * 上报插件市场页面曝光埋点
     */
    private reportPageShowTelemetry;
}
