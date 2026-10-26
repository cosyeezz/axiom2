import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { PlanStorageService } from '../tools/plan-storage-service';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class PlanCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly sessionManager: SessionManager;
    protected readonly planStorageService: PlanStorageService;
    execute(ctx: CommandExecuteContext): Promise<void>;
}
