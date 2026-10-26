import { CommandExecuteContext, CommandExecutor } from './command-protocol';
/**
 * /btw (By The Way) Command Executor
 *
 * Registration only: the TUI routes both bare and inline /btw to BtwPanel.
 * Tool-enabled tasks are created only by the panel's explicit f action.
 */
export declare class BtwCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    execute(_ctx: CommandExecuteContext): Promise<void>;
}
