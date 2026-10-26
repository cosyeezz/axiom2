import { DebugService } from '../debug/debug-protocol';
import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class DebugCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly sessionManager: SessionManager;
    protected readonly debugService: DebugService;
    execute(ctx: CommandExecuteContext): Promise<void>;
    private run;
    private isDebugEnabled;
    private enableDebugLogging;
    private formatFileSize;
}
