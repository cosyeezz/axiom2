import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { EndpointProvider } from '../loopback/server-protocol';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
/**
 * `/web`：在默认浏览器中打开当前会话的 Web UI。
 *
 * endpoint 由 loopback 服务提供，无 Web UI 的宿主（无 loopback / 远端会话）
 * 会拿不到地址，此时只提示不可用，不误开浏览器。
 */
export declare class WebCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly endpointProvider: EndpointProvider;
    protected readonly sessionManager: SessionManager;
    execute(ctx: CommandExecuteContext): Promise<void>;
    private write;
}
