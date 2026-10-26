import { NavigationManager } from '../navigation';
import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class RenameCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly sessionManager: SessionManager;
    protected readonly navigationManager: NavigationManager;
    execute(ctx: CommandExecuteContext): Promise<void>;
}
