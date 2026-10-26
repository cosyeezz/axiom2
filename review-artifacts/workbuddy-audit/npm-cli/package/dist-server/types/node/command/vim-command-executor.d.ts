import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
import { VimManager } from '../vim';
export declare class VimCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly sessionManager: SessionManager;
    protected readonly vimManager: VimManager;
    execute(ctx: CommandExecuteContext): Promise<void>;
}
