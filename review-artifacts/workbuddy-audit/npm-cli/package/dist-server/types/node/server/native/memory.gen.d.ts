import { Context, Effect, Layer } from 'effect';
import { type ConditionalRulesServiceImpl } from '../../memory/conditional-rules-service';
import { type GlobMatcherImpl } from '../../memory/glob-matcher';
import { type MemoryCacheImpl } from '../../memory/memory-cache';
import { type MemoryExtractionServiceImpl } from '../../memory/memory-extraction-service';
import { type MemoryExtractionStopHook } from '../../memory/memory-extraction-stop-hook';
import { type MemoryFreshnessPostToolHook } from '../../memory/memory-freshness-post-tool-hook';
import { type MemoryLoaderImpl } from '../../memory/memory-loader';
import { type MemoryManagerImpl } from '../../memory/memory-manager';
import { type MemoryParserImpl } from '../../memory/memory-parser';
import { type MemoryRelevanceServiceImpl } from '../../memory/memory-relevance-service';
import { type MemoryValidatorImpl } from '../../memory/memory-validator';
import { type SubdirectoryMemoryLoaderImpl } from '../../memory/subdirectory-memory-loader';
declare const MemoryParserImplKey_base: Context.ServiceClass<MemoryParserImplKey, "server/native/MemoryParserImpl", MemoryParserImpl>;
export declare class MemoryParserImplKey extends MemoryParserImplKey_base {
}
export declare const MemoryParserImplLayer: Layer.Layer<MemoryParserImplKey, never, never>;
declare const MemoryValidatorImplKey_base: Context.ServiceClass<MemoryValidatorImplKey, "server/native/MemoryValidatorImpl", MemoryValidatorImpl>;
export declare class MemoryValidatorImplKey extends MemoryValidatorImplKey_base {
}
export declare const MemoryValidatorImplLayer: Layer.Layer<MemoryValidatorImplKey, never, never>;
declare const MemoryLoaderImplKey_base: Context.ServiceClass<MemoryLoaderImplKey, "server/native/MemoryLoaderImpl", MemoryLoaderImpl>;
export declare class MemoryLoaderImplKey extends MemoryLoaderImplKey_base {
}
export declare const MemoryLoaderImplLayer: Layer.Layer<MemoryLoaderImplKey, never, never>;
declare const MemoryCacheImplKey_base: Context.ServiceClass<MemoryCacheImplKey, "server/native/MemoryCacheImpl", MemoryCacheImpl>;
export declare class MemoryCacheImplKey extends MemoryCacheImplKey_base {
}
export declare const MemoryCacheImplLayer: Layer.Layer<MemoryCacheImplKey, never, never>;
declare const MemoryManagerImplKey_base: Context.ServiceClass<MemoryManagerImplKey, "server/native/MemoryManagerImpl", MemoryManagerImpl>;
export declare class MemoryManagerImplKey extends MemoryManagerImplKey_base {
}
export declare const MemoryManagerImplLayer: Layer.Layer<MemoryManagerImplKey, never, never>;
declare const GlobMatcherImplKey_base: Context.ServiceClass<GlobMatcherImplKey, "server/native/GlobMatcherImpl", GlobMatcherImpl>;
export declare class GlobMatcherImplKey extends GlobMatcherImplKey_base {
}
export declare const GlobMatcherImplLayer: Layer.Layer<GlobMatcherImplKey, never, never>;
declare const SubdirectoryMemoryLoaderImplKey_base: Context.ServiceClass<SubdirectoryMemoryLoaderImplKey, "server/native/SubdirectoryMemoryLoaderImpl", SubdirectoryMemoryLoaderImpl>;
export declare class SubdirectoryMemoryLoaderImplKey extends SubdirectoryMemoryLoaderImplKey_base {
}
export declare const SubdirectoryMemoryLoaderImplLayer: Layer.Layer<SubdirectoryMemoryLoaderImplKey, never, never>;
declare const ConditionalRulesServiceImplKey_base: Context.ServiceClass<ConditionalRulesServiceImplKey, "server/native/ConditionalRulesServiceImpl", ConditionalRulesServiceImpl>;
export declare class ConditionalRulesServiceImplKey extends ConditionalRulesServiceImplKey_base {
}
export declare const ConditionalRulesServiceImplLayer: Layer.Layer<ConditionalRulesServiceImplKey, never, never>;
declare const MemoryExtractionServiceImplKey_base: Context.ServiceClass<MemoryExtractionServiceImplKey, "server/native/MemoryExtractionServiceImpl", MemoryExtractionServiceImpl>;
export declare class MemoryExtractionServiceImplKey extends MemoryExtractionServiceImplKey_base {
}
export declare const MemoryExtractionServiceImplLayer: Layer.Layer<MemoryExtractionServiceImplKey, never, never>;
declare const MemoryExtractionStopHookKey_base: Context.ServiceClass<MemoryExtractionStopHookKey, "server/native/MemoryExtractionStopHook", MemoryExtractionStopHook>;
export declare class MemoryExtractionStopHookKey extends MemoryExtractionStopHookKey_base {
}
export declare const MemoryExtractionStopHookLayer: Layer.Layer<MemoryExtractionStopHookKey, never, never>;
declare const MemoryFreshnessPostToolHookKey_base: Context.ServiceClass<MemoryFreshnessPostToolHookKey, "server/native/MemoryFreshnessPostToolHook", MemoryFreshnessPostToolHook>;
export declare class MemoryFreshnessPostToolHookKey extends MemoryFreshnessPostToolHookKey_base {
}
export declare const MemoryFreshnessPostToolHookLayer: Layer.Layer<MemoryFreshnessPostToolHookKey, never, never>;
declare const MemoryRelevanceServiceImplKey_base: Context.ServiceClass<MemoryRelevanceServiceImplKey, "server/native/MemoryRelevanceServiceImpl", MemoryRelevanceServiceImpl>;
export declare class MemoryRelevanceServiceImplKey extends MemoryRelevanceServiceImplKey_base {
}
export declare const MemoryRelevanceServiceImplLayer: Layer.Layer<MemoryRelevanceServiceImplKey, never, never>;
export declare const layer: Layer.Layer<MemoryParserImplKey | MemoryValidatorImplKey | MemoryLoaderImplKey | MemoryCacheImplKey | MemoryManagerImplKey | GlobMatcherImplKey | SubdirectoryMemoryLoaderImplKey | ConditionalRulesServiceImplKey | MemoryExtractionServiceImplKey | MemoryExtractionStopHookKey | MemoryFreshnessPostToolHookKey | MemoryRelevanceServiceImplKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof MemoryParserImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof MemoryValidatorImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof MemoryLoaderImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof MemoryCacheImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof MemoryManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof GlobMatcherImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SubdirectoryMemoryLoaderImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof ConditionalRulesServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof MemoryExtractionServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof MemoryExtractionStopHookKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof MemoryFreshnessPostToolHookKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof MemoryRelevanceServiceImplKey;
    mode: "rebind";
})[];
export declare const warmup: Effect.Effect<void, never, MemoryParserImplKey | MemoryValidatorImplKey | MemoryLoaderImplKey | MemoryCacheImplKey | MemoryManagerImplKey | GlobMatcherImplKey | SubdirectoryMemoryLoaderImplKey | ConditionalRulesServiceImplKey | MemoryExtractionServiceImplKey | MemoryExtractionStopHookKey | MemoryFreshnessPostToolHookKey | MemoryRelevanceServiceImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
