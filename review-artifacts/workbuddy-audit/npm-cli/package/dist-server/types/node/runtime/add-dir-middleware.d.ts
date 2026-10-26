import { Context, Middleware } from '@celljs/web/lib/node';
import { ConsoleManager } from '../console';
import { NavigationManager } from '../navigation';
import { WorkspaceFolderManager } from '../runtime';
import { SessionManager } from '../../vendor/cbc-core/node/index.js';
export declare class AddDirMiddleWare implements Middleware {
    protected readonly sessionManager: SessionManager;
    protected readonly workspaceFolderManager: WorkspaceFolderManager;
    protected readonly navigationManager: NavigationManager;
    protected readonly consoleManager: ConsoleManager;
    handle(ctx: Context, next: () => Promise<void>): Promise<void>;
    readonly priority: number;
}
