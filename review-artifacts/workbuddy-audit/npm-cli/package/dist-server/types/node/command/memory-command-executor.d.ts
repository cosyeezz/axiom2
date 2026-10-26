import { Logger } from '@genie/telemetry';
import { MemoryManager } from '../memory';
import { NavigationManager } from '../navigation';
import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { UserStateManager } from '../tips';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class MemoryCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly memoryManager: MemoryManager;
    protected readonly logger: Logger;
    protected readonly sessionManager: SessionManager;
    protected readonly navigationManager: NavigationManager;
    protected readonly userStateManager?: UserStateManager;
    execute(ctx: CommandExecuteContext): Promise<void>;
}
