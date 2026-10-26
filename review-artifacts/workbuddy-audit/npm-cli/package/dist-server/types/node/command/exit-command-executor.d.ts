import { CheckpointService } from '@genie/cbc-checkpoint';
import { SessionHookManager } from '../../vendor/cbc-core/node/index.js';
import { type IWorktreeChangeDetector, type IWorktreeSessionManager } from '@genie/cbc-worktree';
import { type CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class ExitCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly checkpointService: CheckpointService;
    protected readonly sessionHookManager: SessionHookManager;
    protected readonly worktreeSessionManager?: IWorktreeSessionManager;
    protected readonly worktreeChangeDetector?: IWorktreeChangeDetector;
    execute(ctx: CommandExecuteContext): Promise<void>;
}
