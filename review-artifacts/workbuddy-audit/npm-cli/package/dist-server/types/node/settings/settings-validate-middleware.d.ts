import { PathResolver } from '@celljs/web';
import { Context, Middleware, RequestMatcher } from '@celljs/web/lib/node';
export declare class SettingsValidateMiddleWare implements Middleware {
    protected readonly requestMatcher: RequestMatcher;
    protected readonly pathResolver: PathResolver;
    readonly priority: number;
    handle(ctx: Context, next: () => Promise<void>): Promise<void>;
    private canHandle;
}
