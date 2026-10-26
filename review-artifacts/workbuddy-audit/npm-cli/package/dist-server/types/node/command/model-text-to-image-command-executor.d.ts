import { ProductManager } from '@genie/product';
import { NavigationManager } from '../navigation';
import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class ModelTextToImageCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly navigationManager: NavigationManager;
    protected readonly sessionManager: SessionManager;
    protected readonly productManager: ProductManager;
    execute(ctx: CommandExecuteContext): Promise<void>;
    /**
     * 获取所有文生图模型
     */
    private getTextToImageModels;
}
