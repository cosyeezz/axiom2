import { Context, Effect, Layer } from 'effect';
import { type InsightsReportServiceImpl } from '../../stats/insights-report-service';
import { type SessionFacetServiceImpl } from '../../stats/session-facet-service';
import { type StatsServiceImpl } from '../../stats/stats-service';
declare const InsightsReportServiceImplKey_base: Context.ServiceClass<InsightsReportServiceImplKey, "server/native/InsightsReportServiceImpl", InsightsReportServiceImpl>;
export declare class InsightsReportServiceImplKey extends InsightsReportServiceImplKey_base {
}
export declare const InsightsReportServiceImplLayer: Layer.Layer<InsightsReportServiceImplKey, never, never>;
declare const SessionFacetServiceImplKey_base: Context.ServiceClass<SessionFacetServiceImplKey, "server/native/SessionFacetServiceImpl", SessionFacetServiceImpl>;
export declare class SessionFacetServiceImplKey extends SessionFacetServiceImplKey_base {
}
export declare const SessionFacetServiceImplLayer: Layer.Layer<SessionFacetServiceImplKey, never, never>;
declare const StatsServiceImplKey_base: Context.ServiceClass<StatsServiceImplKey, "server/native/StatsServiceImpl", StatsServiceImpl>;
export declare class StatsServiceImplKey extends StatsServiceImplKey_base {
}
export declare const StatsServiceImplLayer: Layer.Layer<StatsServiceImplKey, never, never>;
export declare const layer: Layer.Layer<InsightsReportServiceImplKey | SessionFacetServiceImplKey | StatsServiceImplKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof InsightsReportServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SessionFacetServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof StatsServiceImplKey;
    mode: "rebind";
})[];
export declare const warmup: Effect.Effect<void, never, InsightsReportServiceImplKey | SessionFacetServiceImplKey | StatsServiceImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
