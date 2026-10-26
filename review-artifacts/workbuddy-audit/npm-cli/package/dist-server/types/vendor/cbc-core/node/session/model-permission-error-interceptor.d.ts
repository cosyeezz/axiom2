import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import { ModelResponseInterceptor, ModelResponseInterceptorContext } from './session-protocol';
/**
 * Interceptor that handles model permission errors (code 11136).
 *
 * When the backend returns "model not allowed", this interceptor:
 * 1. Forces a product configuration refresh via ProductManager.sync(true)
 * 2. Waits for AgentManager to rebuild models (triggered automatically by onDidChange)
 * 3. Appends the refreshed model list to the error message for user guidance
 *
 * This interceptor does NOT retry the request — it returns void so the original
 * error is displayed to the user with up-to-date model availability info.
 */
export declare class ModelPermissionErrorInterceptor implements ModelResponseInterceptor {
    protected readonly logger: Logger;
    protected readonly productManager: ProductManager;
    intercept(ctx: ModelResponseInterceptorContext): Promise<boolean | void>;
    /**
     * Extract the business error code from the result object.
     *
     * The error structure from ModelErrorAnalyzer is:
     * ctx.result.error = { error: { code: number, message: string } }
     *
     * Also handles cases where the code is nested in a JSON string within the message.
     */
    private extractErrorCode;
    /**
     * Try to extract error code from a JSON-encoded message string.
     * The error-analyzer wraps the response in JSON.stringify({ error: { code, message } }).
     */
    private extractCodeFromMessage;
    /**
     * Append refreshed model list to the error message so the user can see available alternatives.
     */
    private appendRefreshedModelList;
}
//# sourceMappingURL=model-permission-error-interceptor.d.ts.map