import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { NavigationManager } from '../navigation';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class ResumeCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly sessionManager: SessionManager;
    protected readonly navigationManager: NavigationManager;
    protected readonly logger: Logger;
    execute(ctx: CommandExecuteContext): Promise<void>;
    private handleList;
    /**
     * Notify ACP clients that session has been switched via session_info_update.
     * This allows Web UI to update its sessionId, URL, and reload chat history.
     * Broadcast to all connections — the stored acpConnectionId goes stale on
     * reconnect/multi-client and unicast used to drop the reset silently.
     */
    private notifySessionReset;
}
