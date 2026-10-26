import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import { ProductEnvService } from '../product/product-protocol';
import { SettingsManager } from '../settings/settings-protocol';
import { ModelRequestProcessor } from './model-protocol';
/**
 * Request processor that compresses request bodies using gzip.
 *
 * When `ProductFeature.RequestBodyGzip` is enabled, this processor
 * compresses the request body and adds the `Content-Encoding: gzip` header.
 *
 * Gzip is skipped when the request targets a non-official endpoint:
 * - Model has a custom URL configured (modelConfig.url)
 * - User has set CODEBUDDY_BASE_URL (env var or settings)
 * - Current environment is not Internal/External/IOA (e.g., selfhosted/cloudhosted)
 *
 * Benefits:
 * - Reduces bandwidth consumption for large request payloads
 * - Improves request latency, especially on slow networks
 * - Model request bodies typically contain large text (conversation history,
 *   system prompts, tool definitions) that compress well
 */
export declare class GzipRequestProcessor implements ModelRequestProcessor {
    priority: number;
    protected readonly logger: Logger;
    protected readonly productManager: ProductManager;
    protected readonly productEnvService: ProductEnvService;
    /** Environments where gzip compression is supported (SaaS + iOA only) */
    private static readonly GZIP_SUPPORTED_ENVS;
    protected readonly settingsManager: SettingsManager;
    init(): void;
    process(axiosConfig: any): Promise<void>;
    /**
     * Extract the model ID from the request data.
     */
    private extractModelId;
}
