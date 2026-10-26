import { Context, Middleware } from '@celljs/web/lib/node';
import { DebugService } from './debug-protocol';
export declare class DebugMiddleware implements Middleware {
    readonly priority: number;
    protected readonly debugService: DebugService;
    handle(ctx: Context, next: () => Promise<void>): Promise<void>;
    private parseDebugConfig;
}
