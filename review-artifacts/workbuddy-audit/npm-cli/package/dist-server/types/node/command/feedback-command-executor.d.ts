import { FeedbackService } from '../feedback';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class FeedbackCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly feedbackService: FeedbackService;
    execute(ctx: CommandExecuteContext): Promise<void>;
}
