import { type LanguageModel, ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import { ModelRequestProcessor } from '../model-protocol';
/**
 * Catalog-driven request compatibility processor. Requests to a product
 * gateway pass through untouched; every other chat-completions request is
 * rewritten by the openai-compatible dialect: universal SDK cleanup, then
 * catalog-driven rules (pi `compat.*` fields and the local overlays), then
 * custom-model SDK hygiene.
 *
 * `caps` for a request = catalog entry ⊕ provider overlay ⊕ model overlay ⊕
 * the model's own `compat` / `thinkingLevelMap` from product config
 * (`models.json`); the model's `provider` field and the request host pick the
 * catalog entry.
 */
export declare class CompatibilityRequestProcessor implements ModelRequestProcessor {
    priority: number;
    readonly wires: readonly ["chat-completions"];
    protected readonly productManager: ProductManager;
    protected readonly logger: Logger;
    init(): void;
    process(axiosConfig: any): Promise<void>;
}
export declare function findCompatibleModelConfig(models: readonly LanguageModel[] | undefined, rawWireModelId: string, requestModelId?: string): LanguageModel | undefined;
