import { ProductManager } from '@genie/product';
import { McpManager } from '../mcp';
import { NavigationManager } from '../navigation';
import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class McpCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly mcpManager: McpManager;
    protected readonly navigationManager: NavigationManager;
    protected readonly sessionManager: SessionManager;
    protected readonly productManager: ProductManager;
    execute(ctx: CommandExecuteContext): Promise<void>;
}
