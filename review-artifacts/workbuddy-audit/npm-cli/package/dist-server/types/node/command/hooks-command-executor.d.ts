import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class HooksCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly sessionManager: SessionManager;
    execute(_ctx: CommandExecuteContext): Promise<void>;
}
