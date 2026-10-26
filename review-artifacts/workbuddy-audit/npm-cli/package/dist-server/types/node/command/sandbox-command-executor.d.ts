import { CommandExecuteContext, CommandExecutor } from './command-protocol';
import { SettingsManager as ISettingsManager } from '../settings/settings-protocol';
import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { NavigationManager } from '../navigation';
import { BashSandboxManager as IBashSandboxManager } from '../bash-sandbox';
export declare class SandboxCommandExecutor implements CommandExecutor {
    protected readonly settingsManager: ISettingsManager;
    protected readonly sessionManager: SessionManager;
    protected readonly navigationManager: NavigationManager;
    protected readonly bashSandboxManager: IBashSandboxManager;
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    execute(ctx: CommandExecuteContext): Promise<void>;
    /**
     * 处理 exclude 子命令
     * 用法: /sandbox exclude <command>
     */
    private handleExcludeCommand;
}
