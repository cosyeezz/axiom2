import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { NavigationManager } from '../navigation';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class ConfigCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly sessionManager: SessionManager;
    protected readonly navigationManager: NavigationManager;
    execute(ctx: CommandExecuteContext): Promise<void>;
    private handleList;
    private handleGet;
    private handleSet;
    private outputResult;
}
