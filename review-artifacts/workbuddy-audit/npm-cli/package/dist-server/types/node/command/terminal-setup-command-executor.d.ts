import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class TerminalSetupCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    execute(ctx: CommandExecuteContext): Promise<void>;
}
