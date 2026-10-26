import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class CopyCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly sessionManager: SessionManager;
    execute(ctx: CommandExecuteContext): Promise<void>;
    private run;
}
