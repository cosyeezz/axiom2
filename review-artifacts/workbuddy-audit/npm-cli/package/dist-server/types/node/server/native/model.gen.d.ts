import { Context, Effect, Layer } from 'effect';
import { type ModelErrorAnalyzerImpl } from '../../model/error-analyzer';
import { type GzipRequestProcessor } from '../../model/gzip-request-processor';
import { type MessageQueueRequestProcessor } from '../../model/message-queue-request-processor';
import { type CompatibilityRequestProcessor } from '../../model/model-compatibility/model-compatibility-processor';
import { type ModelProviderImpl } from '../../model/model-provider';
import { type ModelRequestProcessorImpl } from '../../model/model-request-processor';
import { type SensitiveModelRequestProcessor } from '../../model/sensitive-model-request-processor';
declare const ModelErrorAnalyzerImplKey_base: Context.ServiceClass<ModelErrorAnalyzerImplKey, "server/native/ModelErrorAnalyzerImpl", ModelErrorAnalyzerImpl>;
export declare class ModelErrorAnalyzerImplKey extends ModelErrorAnalyzerImplKey_base {
}
export declare const ModelErrorAnalyzerImplLayer: Layer.Layer<ModelErrorAnalyzerImplKey, never, never>;
declare const GzipRequestProcessorKey_base: Context.ServiceClass<GzipRequestProcessorKey, "server/native/GzipRequestProcessor", GzipRequestProcessor>;
export declare class GzipRequestProcessorKey extends GzipRequestProcessorKey_base {
}
export declare const GzipRequestProcessorLayer: Layer.Layer<GzipRequestProcessorKey, never, never>;
declare const MessageQueueRequestProcessorKey_base: Context.ServiceClass<MessageQueueRequestProcessorKey, "server/native/MessageQueueRequestProcessor", MessageQueueRequestProcessor>;
export declare class MessageQueueRequestProcessorKey extends MessageQueueRequestProcessorKey_base {
}
export declare const MessageQueueRequestProcessorLayer: Layer.Layer<MessageQueueRequestProcessorKey, never, never>;
declare const CompatibilityRequestProcessorKey_base: Context.ServiceClass<CompatibilityRequestProcessorKey, "server/native/CompatibilityRequestProcessor", CompatibilityRequestProcessor>;
export declare class CompatibilityRequestProcessorKey extends CompatibilityRequestProcessorKey_base {
}
export declare const CompatibilityRequestProcessorLayer: Layer.Layer<CompatibilityRequestProcessorKey, never, never>;
declare const ModelProviderImplKey_base: Context.ServiceClass<ModelProviderImplKey, "server/native/ModelProviderImpl", ModelProviderImpl>;
export declare class ModelProviderImplKey extends ModelProviderImplKey_base {
}
export declare const ModelProviderImplLayer: Layer.Layer<ModelProviderImplKey, never, never>;
declare const ModelRequestProcessorImplKey_base: Context.ServiceClass<ModelRequestProcessorImplKey, "server/native/ModelRequestProcessorImpl", ModelRequestProcessorImpl>;
export declare class ModelRequestProcessorImplKey extends ModelRequestProcessorImplKey_base {
}
export declare const ModelRequestProcessorImplLayer: Layer.Layer<ModelRequestProcessorImplKey, never, never>;
declare const SensitiveModelRequestProcessorKey_base: Context.ServiceClass<SensitiveModelRequestProcessorKey, "server/native/SensitiveModelRequestProcessor", SensitiveModelRequestProcessor>;
export declare class SensitiveModelRequestProcessorKey extends SensitiveModelRequestProcessorKey_base {
}
export declare const SensitiveModelRequestProcessorLayer: Layer.Layer<SensitiveModelRequestProcessorKey, never, never>;
export declare const layer: Layer.Layer<ModelErrorAnalyzerImplKey | GzipRequestProcessorKey | MessageQueueRequestProcessorKey | CompatibilityRequestProcessorKey | ModelProviderImplKey | ModelRequestProcessorImplKey | SensitiveModelRequestProcessorKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof ModelErrorAnalyzerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof GzipRequestProcessorKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof MessageQueueRequestProcessorKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof CompatibilityRequestProcessorKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof ModelProviderImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof ModelRequestProcessorImplKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof SensitiveModelRequestProcessorKey;
    mode: "add";
})[];
export declare const warmup: Effect.Effect<void, never, ModelErrorAnalyzerImplKey | GzipRequestProcessorKey | MessageQueueRequestProcessorKey | CompatibilityRequestProcessorKey | ModelProviderImplKey | ModelRequestProcessorImplKey | SensitiveModelRequestProcessorKey>;
export declare const deps: ReadonlyArray<string>;
export {};
