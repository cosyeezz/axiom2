import { EventService } from '@genie/telemetry';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class HelpCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly eventService: EventService;
    execute(ctx: CommandExecuteContext): Promise<void>;
}
