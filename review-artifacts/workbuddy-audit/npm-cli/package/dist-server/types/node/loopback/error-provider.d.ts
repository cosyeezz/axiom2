import { Logger } from '@celljs/core';
import { Context } from '@celljs/core/lib/node';
import { ErrorHandler } from '@celljs/web/lib/node';
export declare class CliServerErrorHandler implements ErrorHandler {
    readonly priority: number;
    readonly logger: Logger;
    canHandle(ctx: Context, err: Error): Promise<boolean>;
    handle(ctx: Context, err: Error): Promise<void>;
}
