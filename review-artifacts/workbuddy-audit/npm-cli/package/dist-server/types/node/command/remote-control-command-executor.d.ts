/**
 * Remote Control Command Executor
 *
 * Slash command /remote-control for managing remote control long connection clients.
 * Usage:
 *   /remote-control                        Open interactive UI panel
 *   /remote-control list                   List all registered clients
 *   /remote-control <client> [subcommand]  Manage a specific client
 *   /remote-control wecom                  Start default wecom connection
 *   /remote-control wecom add              Add a new wecom bot instance
 *   /remote-control wecom:bot1 start       Start a specific instance
 *   /remote-control wecom:bot1 stop        Stop a specific instance
 *   /remote-control wecom:bot1 remove      Remove a specific instance
 */
import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { NavigationManager } from '../navigation';
import { type ILongConnectionClientRegistry, type IRemoteControlService } from '../remote-control/remote-control-protocol';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class RemoteControlCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected get sessionManager(): SessionManager;
    protected get navigationManager(): NavigationManager;
    protected get remoteControlService(): IRemoteControlService;
    protected get clientRegistry(): ILongConnectionClientRegistry;
    protected isRemoteControlEnabled(): Promise<boolean>;
    execute(ctx: CommandExecuteContext): Promise<void>;
    private handleClientCommand;
    /**
     * Handle adding a new client instance.
     * Usage: /remote-control wecom add <instanceId> <botId> <secret>
     */
    private handleAddInstance;
    /**
     * Handle removing a client instance.
     */
    private handleRemoveInstance;
    private resolveClient;
    private startClient;
    private stopClient;
    private formatClientList;
    private formatClientStatus;
}
