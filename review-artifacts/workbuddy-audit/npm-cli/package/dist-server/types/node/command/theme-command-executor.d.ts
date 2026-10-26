import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class ThemeCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    execute(ctx: CommandExecuteContext): Promise<void>;
}
