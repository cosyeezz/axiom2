import { Logger } from '@celljs/core';
import { ProductManager } from '@genie/product';
import { ExternalUriOpener } from '@genie/runtime';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class UpgradeCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly productManager: ProductManager;
    protected readonly externalUriOpener: ExternalUriOpener;
    protected readonly logger: Logger;
    execute(ctx: CommandExecuteContext): Promise<void>;
}
