import { type SessionManager as SessionManagerInterface } from '../../vendor/cbc-core/node/index.js';
import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import { type ImageBlobService } from '../blob-store/blob-store-protocol';
import { type SensitiveModelBoundary as SensitiveModelBoundaryInterface } from '../sensitive-content';
import { ModelRequestProcessor } from './model-protocol';
/**
 * Sensitive-content boundary of the model transport. Sensitive rule detection is owned by history
 * admission; this processor registers managed ciphertexts for streaming response restoration and
 * projects request images for the selected model (relay/direct by model image-input mode).
 * ToolRiskReviewModelRequestProcessor (9995), AiccModelRequestProcessor (9998, AICC field
 * encryption) and gzip (9999) run after it.
 */
export declare class SensitiveModelRequestProcessor implements ModelRequestProcessor {
    readonly priority = 9990;
    protected readonly boundary: SensitiveModelBoundaryInterface;
    protected readonly sessionManager: SessionManagerInterface;
    protected readonly productManager: ProductManager;
    protected readonly imageBlobService: ImageBlobService;
    protected readonly logger: Logger;
    process(axiosConfig: any): Promise<void>;
}
