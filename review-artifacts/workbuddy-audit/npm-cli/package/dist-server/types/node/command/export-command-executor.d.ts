import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class ExportCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    execute(ctx: CommandExecuteContext): Promise<void>;
}
