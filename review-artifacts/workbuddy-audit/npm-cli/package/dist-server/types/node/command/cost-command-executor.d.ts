import { ProductManager } from '@genie/product';
import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { CostService } from '../telemetry';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class CostCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly sessionManager: SessionManager;
    protected readonly costService: CostService;
    protected readonly productManager: ProductManager;
    execute(ctx: CommandExecuteContext): Promise<void>;
}
