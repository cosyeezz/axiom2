import { Context, Effect, Layer } from 'effect';
import { type AgentMetricsAggregatorImpl } from '../../galileo/agent-metrics-aggregator';
import { type GalileoChatReporterImpl } from '../../galileo/galileo-chat-reporter';
import { type GalileoServiceImpl } from '../../galileo/galileo-service';
import { type GalileoSessionBridgeImpl } from '../../galileo/galileo-session-bridge';
import { GalileoTimingHook } from '../../galileo/galileo-timing-hook';
import { type GalileoToolResponseErrorReportHook, type GalileoToolThrownErrorReportHook } from '../../galileo/galileo-tool-error-report-hook';
import { type GalileoToolPostHook } from '../../galileo/galileo-tool-post-hook';
import { type GalileoToolPreHook } from '../../galileo/galileo-tool-pre-hook';
import { type GalileoToolStartReportHook } from '../../galileo/galileo-tool-start-report-hook';
import { type GalileoToolSuccessReportHook } from '../../galileo/galileo-tool-success-report-hook';
import { type SessionErrorTrackerImpl } from '../../galileo/session-error-tracker';
declare const GalileoServiceImplKey_base: Context.ServiceClass<GalileoServiceImplKey, "server/native/GalileoServiceImpl", GalileoServiceImpl>;
export declare class GalileoServiceImplKey extends GalileoServiceImplKey_base {
}
export declare const GalileoServiceImplLayer: Layer.Layer<GalileoServiceImplKey, never, never>;
declare const AgentMetricsAggregatorImplKey_base: Context.ServiceClass<AgentMetricsAggregatorImplKey, "server/native/AgentMetricsAggregatorImpl", AgentMetricsAggregatorImpl>;
export declare class AgentMetricsAggregatorImplKey extends AgentMetricsAggregatorImplKey_base {
}
export declare const AgentMetricsAggregatorImplLayer: Layer.Layer<AgentMetricsAggregatorImplKey, never, never>;
declare const GalileoChatReporterImplKey_base: Context.ServiceClass<GalileoChatReporterImplKey, "server/native/GalileoChatReporterImpl", GalileoChatReporterImpl>;
export declare class GalileoChatReporterImplKey extends GalileoChatReporterImplKey_base {
}
export declare const GalileoChatReporterImplLayer: Layer.Layer<GalileoChatReporterImplKey, never, never>;
declare const GalileoSessionBridgeImplKey_base: Context.ServiceClass<GalileoSessionBridgeImplKey, "server/native/GalileoSessionBridgeImpl", GalileoSessionBridgeImpl>;
export declare class GalileoSessionBridgeImplKey extends GalileoSessionBridgeImplKey_base {
}
export declare const GalileoSessionBridgeImplLayer: Layer.Layer<GalileoSessionBridgeImplKey, never, never>;
declare const SessionErrorTrackerImplKey_base: Context.ServiceClass<SessionErrorTrackerImplKey, "server/native/SessionErrorTrackerImpl", SessionErrorTrackerImpl>;
export declare class SessionErrorTrackerImplKey extends SessionErrorTrackerImplKey_base {
}
export declare const SessionErrorTrackerImplLayer: Layer.Layer<SessionErrorTrackerImplKey, never, never>;
declare const GalileoTimingHookKey_base: Context.ServiceClass<GalileoTimingHookKey, "server/native/GalileoTimingHook", GalileoTimingHook>;
export declare class GalileoTimingHookKey extends GalileoTimingHookKey_base {
}
export declare const GalileoTimingHookLayer: Layer.Layer<GalileoTimingHookKey, never, never>;
declare const GalileoToolResponseErrorReportHookKey_base: Context.ServiceClass<GalileoToolResponseErrorReportHookKey, "server/native/GalileoToolResponseErrorReportHook", GalileoToolResponseErrorReportHook>;
export declare class GalileoToolResponseErrorReportHookKey extends GalileoToolResponseErrorReportHookKey_base {
}
export declare const GalileoToolResponseErrorReportHookLayer: Layer.Layer<GalileoToolResponseErrorReportHookKey, never, never>;
declare const GalileoToolThrownErrorReportHookKey_base: Context.ServiceClass<GalileoToolThrownErrorReportHookKey, "server/native/GalileoToolThrownErrorReportHook", GalileoToolThrownErrorReportHook>;
export declare class GalileoToolThrownErrorReportHookKey extends GalileoToolThrownErrorReportHookKey_base {
}
export declare const GalileoToolThrownErrorReportHookLayer: Layer.Layer<GalileoToolThrownErrorReportHookKey, never, never>;
declare const GalileoToolPostHookKey_base: Context.ServiceClass<GalileoToolPostHookKey, "server/native/GalileoToolPostHook", GalileoToolPostHook>;
export declare class GalileoToolPostHookKey extends GalileoToolPostHookKey_base {
}
export declare const GalileoToolPostHookLayer: Layer.Layer<GalileoToolPostHookKey, never, never>;
declare const GalileoToolPreHookKey_base: Context.ServiceClass<GalileoToolPreHookKey, "server/native/GalileoToolPreHook", GalileoToolPreHook>;
export declare class GalileoToolPreHookKey extends GalileoToolPreHookKey_base {
}
export declare const GalileoToolPreHookLayer: Layer.Layer<GalileoToolPreHookKey, never, never>;
declare const GalileoToolStartReportHookKey_base: Context.ServiceClass<GalileoToolStartReportHookKey, "server/native/GalileoToolStartReportHook", GalileoToolStartReportHook>;
export declare class GalileoToolStartReportHookKey extends GalileoToolStartReportHookKey_base {
}
export declare const GalileoToolStartReportHookLayer: Layer.Layer<GalileoToolStartReportHookKey, never, never>;
declare const GalileoToolSuccessReportHookKey_base: Context.ServiceClass<GalileoToolSuccessReportHookKey, "server/native/GalileoToolSuccessReportHook", GalileoToolSuccessReportHook>;
export declare class GalileoToolSuccessReportHookKey extends GalileoToolSuccessReportHookKey_base {
}
export declare const GalileoToolSuccessReportHookLayer: Layer.Layer<GalileoToolSuccessReportHookKey, never, never>;
export declare const layer: Layer.Layer<GalileoServiceImplKey | AgentMetricsAggregatorImplKey | GalileoChatReporterImplKey | GalileoSessionBridgeImplKey | SessionErrorTrackerImplKey | GalileoTimingHookKey | GalileoToolResponseErrorReportHookKey | GalileoToolThrownErrorReportHookKey | GalileoToolPostHookKey | GalileoToolPreHookKey | GalileoToolStartReportHookKey | GalileoToolSuccessReportHookKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof GalileoServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof GalileoServiceImplKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof AgentMetricsAggregatorImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof AgentMetricsAggregatorImplKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof GalileoChatReporterImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof GalileoSessionBridgeImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SessionErrorTrackerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof GalileoTimingHookKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof GalileoToolResponseErrorReportHookKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof GalileoToolThrownErrorReportHookKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof GalileoToolPostHookKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof GalileoToolPreHookKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof GalileoToolStartReportHookKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof GalileoToolSuccessReportHookKey;
    mode: "add";
})[];
export declare const warmup: Effect.Effect<void, never, GalileoServiceImplKey | AgentMetricsAggregatorImplKey | GalileoChatReporterImplKey | GalileoSessionBridgeImplKey | SessionErrorTrackerImplKey | GalileoTimingHookKey | GalileoToolResponseErrorReportHookKey | GalileoToolThrownErrorReportHookKey | GalileoToolPostHookKey | GalileoToolPreHookKey | GalileoToolStartReportHookKey | GalileoToolSuccessReportHookKey>;
export declare const deps: ReadonlyArray<string>;
export {};
