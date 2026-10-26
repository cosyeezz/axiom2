import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { NavigationManager } from '../navigation';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class ModelCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly navigationManager: NavigationManager;
    protected readonly sessionManager: SessionManager;
    execute(ctx: CommandExecuteContext): Promise<void>;
}
