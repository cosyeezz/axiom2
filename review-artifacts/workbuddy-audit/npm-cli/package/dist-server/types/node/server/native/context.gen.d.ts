import { Context, Effect, Layer } from 'effect';
import { DeferredToolsDescriptionBuilderImpl } from '../../context/deferred-tools-description-builder';
import { TikTokenCalculatorService } from '../../context/token-calculator/token-calculator-service';
import { ContextCompactSummarizerImpl, PromptContextProviderImpl, PromptRendererImpl } from '../../../vendor/cbc-core/node/index.js';
declare const DeferredToolsDescriptionBuilderImplKey_base: Context.ServiceClass<DeferredToolsDescriptionBuilderImplKey, "server/native/DeferredToolsDescriptionBuilderImpl", DeferredToolsDescriptionBuilderImpl>;
export declare class DeferredToolsDescriptionBuilderImplKey extends DeferredToolsDescriptionBuilderImplKey_base {
}
export declare const DeferredToolsDescriptionBuilderImplLayer: Layer.Layer<DeferredToolsDescriptionBuilderImplKey, never, never>;
declare const TikTokenCalculatorServiceKey_base: Context.ServiceClass<TikTokenCalculatorServiceKey, "server/native/TikTokenCalculatorService", TikTokenCalculatorService>;
export declare class TikTokenCalculatorServiceKey extends TikTokenCalculatorServiceKey_base {
}
export declare const TikTokenCalculatorServiceLayer: Layer.Layer<TikTokenCalculatorServiceKey, never, never>;
declare const ContextCompactSummarizerImplKey_base: Context.ServiceClass<ContextCompactSummarizerImplKey, "server/native/ContextCompactSummarizerImpl", ContextCompactSummarizerImpl>;
export declare class ContextCompactSummarizerImplKey extends ContextCompactSummarizerImplKey_base {
}
export declare const ContextCompactSummarizerImplLayer: Layer.Layer<ContextCompactSummarizerImplKey, never, never>;
declare const PromptContextProviderImplKey_base: Context.ServiceClass<PromptContextProviderImplKey, "server/native/PromptContextProviderImpl", PromptContextProviderImpl>;
export declare class PromptContextProviderImplKey extends PromptContextProviderImplKey_base {
}
export declare const PromptContextProviderImplLayer: Layer.Layer<PromptContextProviderImplKey, never, never>;
declare const PromptRendererImplKey_base: Context.ServiceClass<PromptRendererImplKey, "server/native/PromptRendererImpl", PromptRendererImpl>;
export declare class PromptRendererImplKey extends PromptRendererImplKey_base {
}
export declare const PromptRendererImplLayer: Layer.Layer<PromptRendererImplKey, never, never>;
export declare const layer: Layer.Layer<DeferredToolsDescriptionBuilderImplKey | TikTokenCalculatorServiceKey | ContextCompactSummarizerImplKey | PromptContextProviderImplKey | PromptRendererImplKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof DeferredToolsDescriptionBuilderImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof TikTokenCalculatorServiceKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof ContextCompactSummarizerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof PromptContextProviderImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof PromptRendererImplKey;
    mode: "rebind";
})[];
export declare const warmup: Effect.Effect<void, never, DeferredToolsDescriptionBuilderImplKey | TikTokenCalculatorServiceKey | ContextCompactSummarizerImplKey | PromptContextProviderImplKey | PromptRendererImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
