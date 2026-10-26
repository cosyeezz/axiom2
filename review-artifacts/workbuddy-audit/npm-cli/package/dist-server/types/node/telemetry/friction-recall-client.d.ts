import { RestOperations } from '@celljs/http';
import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import type { FrictionAnalysisResult } from './friction-analysis';
export declare const FrictionRecallClient: unique symbol;
export interface FrictionRecallClient {
    recall(userPrompt: string): Promise<FrictionAnalysisResult | undefined>;
}
export declare function parseFrictionRecallResponse(payload: unknown): FrictionAnalysisResult | undefined;
export declare class FrictionRecallClientImpl implements FrictionRecallClient {
    protected readonly restOperations: RestOperations;
    protected readonly productManager: ProductManager;
    protected readonly logger: Logger;
    recall(userPrompt: string): Promise<FrictionAnalysisResult | undefined>;
}
