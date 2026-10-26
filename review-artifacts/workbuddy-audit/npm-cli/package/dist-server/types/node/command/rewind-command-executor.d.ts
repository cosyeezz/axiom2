import { CommandExecuteContext, CommandExecutor } from './command-protocol';
/**
 * Rewind 命令执行器
 */
export declare class RewindCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    execute(ctx: CommandExecuteContext): Promise<void>;
}
