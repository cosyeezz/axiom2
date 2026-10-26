import { SessionHookManager, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class ClearCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly sessionManager: SessionManager;
    protected readonly sessionHookManager: SessionHookManager;
    protected readonly logger: Logger;
    execute(ctx: CommandExecuteContext): Promise<void>;
    /**
     * Notify ACP clients that session has been reset via session_info_update.
     * This allows Web UI to update its sessionId and clear chat history.
     */
    private notifySessionReset;
}
