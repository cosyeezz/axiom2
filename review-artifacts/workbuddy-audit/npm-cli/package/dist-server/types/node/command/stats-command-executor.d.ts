import { NavigationManager } from '../navigation';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
import { SessionManager } from '../../vendor/cbc-core/node/index.js';
export declare class StatsCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly sessionManager: SessionManager;
    protected readonly navigationManager: NavigationManager;
    execute(ctx: CommandExecuteContext): Promise<void>;
}
