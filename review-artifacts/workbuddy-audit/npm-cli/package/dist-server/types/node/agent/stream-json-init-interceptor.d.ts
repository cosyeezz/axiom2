import { AgentRunInterceptor, AgentRunRequest } from '../../vendor/cbc-core/node/index.js';
import { ProductManager } from '@genie/product';
import { CommandManager } from '../command';
export declare class StreamJsonInitInterceptor implements AgentRunInterceptor {
    priority: number;
    protected readonly productManager: ProductManager;
    protected readonly commandManager: CommandManager;
    intercept(request: AgentRunRequest): Promise<void>;
}
