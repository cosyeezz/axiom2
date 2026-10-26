import { type ProductManager } from '@genie/product';
import type { Logger } from '@genie/telemetry';
import type { ImageBlobService } from '../blob-store/blob-store-protocol';
import { type ImageInputMode } from '../utils/non-multimodal-models';
export declare function projectRequestImages(data: any, request: {
    modelId?: string;
    url?: string;
    purpose?: string;
}, dependencies: {
    productManager: ProductManager;
    imageBlobService: ImageBlobService;
    logger: Pick<Logger, 'warn'>;
}): Promise<any>;
export declare function projectImageContextForRequest(body: any, mode: ImageInputMode, imageBlobService: ImageBlobService, logger: Pick<Logger, 'warn'>): Promise<any>;
