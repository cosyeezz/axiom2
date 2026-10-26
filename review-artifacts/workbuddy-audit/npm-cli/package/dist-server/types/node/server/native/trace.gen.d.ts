import { Context, Effect, Layer } from 'effect';
import { type SubagentTraceStartHook, type SubagentTraceStopHook } from '../../trace/hooks/subagent-trace-hooks';
import { type ToolExecutionPostHook } from '../../trace/hooks/tool-execution-post-hook';
import { type ToolExecutionPreHook } from '../../trace/hooks/tool-execution-pre-hook';
import { type TraceCollectorEnrichHook, type TraceCollectorStopHook } from '../../trace/hooks/trace-collector-hook';
import { type TraceStartHook } from '../../trace/hooks/trace-start-hook';
import { type TraceStopHook } from '../../trace/hooks/trace-stop-hook';
import { type CliResourcesProvider } from '../../trace/resources-provider';
import { TraceCollectorProcessor } from '../../trace/trace-collector-processor';
import { type TraceCollectorServiceImpl } from '../../trace/trace-collector-service';
import { type TraceServiceLifecycle } from '../../trace/trace-initializer';
declare const SubagentTraceStartHookKey_base: Context.ServiceClass<SubagentTraceStartHookKey, "server/native/SubagentTraceStartHook", SubagentTraceStartHook>;
export declare class SubagentTraceStartHookKey extends SubagentTraceStartHookKey_base {
}
export declare const SubagentTraceStartHookLayer: Layer.Layer<SubagentTraceStartHookKey, never, never>;
declare const SubagentTraceStopHookKey_base: Context.ServiceClass<SubagentTraceStopHookKey, "server/native/SubagentTraceStopHook", SubagentTraceStopHook>;
export declare class SubagentTraceStopHookKey extends SubagentTraceStopHookKey_base {
}
export declare const SubagentTraceStopHookLayer: Layer.Layer<SubagentTraceStopHookKey, never, never>;
declare const ToolExecutionPostHookKey_base: Context.ServiceClass<ToolExecutionPostHookKey, "server/native/ToolExecutionPostHook", ToolExecutionPostHook>;
export declare class ToolExecutionPostHookKey extends ToolExecutionPostHookKey_base {
}
export declare const ToolExecutionPostHookLayer: Layer.Layer<ToolExecutionPostHookKey, never, never>;
declare const ToolExecutionPreHookKey_base: Context.ServiceClass<ToolExecutionPreHookKey, "server/native/ToolExecutionPreHook", ToolExecutionPreHook>;
export declare class ToolExecutionPreHookKey extends ToolExecutionPreHookKey_base {
}
export declare const ToolExecutionPreHookLayer: Layer.Layer<ToolExecutionPreHookKey, never, never>;
declare const TraceCollectorServiceImplKey_base: Context.ServiceClass<TraceCollectorServiceImplKey, "server/native/TraceCollectorServiceImpl", TraceCollectorServiceImpl>;
export declare class TraceCollectorServiceImplKey extends TraceCollectorServiceImplKey_base {
}
export declare const TraceCollectorServiceImplLayer: Layer.Layer<TraceCollectorServiceImplKey, never, never>;
declare const TraceCollectorEnrichHookKey_base: Context.ServiceClass<TraceCollectorEnrichHookKey, "server/native/TraceCollectorEnrichHook", TraceCollectorEnrichHook>;
export declare class TraceCollectorEnrichHookKey extends TraceCollectorEnrichHookKey_base {
}
export declare const TraceCollectorEnrichHookLayer: Layer.Layer<TraceCollectorEnrichHookKey, never, never>;
declare const TraceCollectorStopHookKey_base: Context.ServiceClass<TraceCollectorStopHookKey, "server/native/TraceCollectorStopHook", TraceCollectorStopHook>;
export declare class TraceCollectorStopHookKey extends TraceCollectorStopHookKey_base {
}
export declare const TraceCollectorStopHookLayer: Layer.Layer<TraceCollectorStopHookKey, never, never>;
declare const TraceStartHookKey_base: Context.ServiceClass<TraceStartHookKey, "server/native/TraceStartHook", TraceStartHook>;
export declare class TraceStartHookKey extends TraceStartHookKey_base {
}
export declare const TraceStartHookLayer: Layer.Layer<TraceStartHookKey, never, never>;
declare const TraceStopHookKey_base: Context.ServiceClass<TraceStopHookKey, "server/native/TraceStopHook", TraceStopHook>;
export declare class TraceStopHookKey extends TraceStopHookKey_base {
}
export declare const TraceStopHookLayer: Layer.Layer<TraceStopHookKey, never, never>;
declare const CliResourcesProviderKey_base: Context.ServiceClass<CliResourcesProviderKey, "server/native/CliResourcesProvider", CliResourcesProvider>;
export declare class CliResourcesProviderKey extends CliResourcesProviderKey_base {
}
export declare const CliResourcesProviderLayer: Layer.Layer<CliResourcesProviderKey, never, never>;
declare const TraceCollectorProcessorKey_base: Context.ServiceClass<TraceCollectorProcessorKey, "server/native/TraceCollectorProcessor", TraceCollectorProcessor>;
export declare class TraceCollectorProcessorKey extends TraceCollectorProcessorKey_base {
}
export declare const TraceCollectorProcessorLayer: Layer.Layer<TraceCollectorProcessorKey, never, never>;
declare const TraceServiceLifecycleKey_base: Context.ServiceClass<TraceServiceLifecycleKey, "server/native/TraceServiceLifecycle", TraceServiceLifecycle>;
export declare class TraceServiceLifecycleKey extends TraceServiceLifecycleKey_base {
}
export declare const TraceServiceLifecycleLayer: Layer.Layer<TraceServiceLifecycleKey, never, never>;
export declare const layer: Layer.Layer<SubagentTraceStartHookKey | SubagentTraceStopHookKey | ToolExecutionPostHookKey | ToolExecutionPreHookKey | TraceCollectorServiceImplKey | TraceCollectorEnrichHookKey | TraceCollectorStopHookKey | TraceStartHookKey | TraceStopHookKey | CliResourcesProviderKey | TraceCollectorProcessorKey | TraceServiceLifecycleKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof SubagentTraceStartHookKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof SubagentTraceStopHookKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof ToolExecutionPostHookKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof ToolExecutionPreHookKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof TraceCollectorServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof TraceCollectorEnrichHookKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof TraceCollectorStopHookKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof TraceStartHookKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof TraceStopHookKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof CliResourcesProviderKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof TraceCollectorProcessorKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof TraceServiceLifecycleKey;
    mode: "add";
})[];
export declare const warmup: Effect.Effect<void, never, SubagentTraceStartHookKey | SubagentTraceStopHookKey | ToolExecutionPostHookKey | ToolExecutionPreHookKey | TraceCollectorServiceImplKey | TraceCollectorEnrichHookKey | TraceCollectorStopHookKey | TraceStartHookKey | TraceStopHookKey | CliResourcesProviderKey | TraceCollectorProcessorKey | TraceServiceLifecycleKey>;
export declare const deps: ReadonlyArray<string>;
export {};
