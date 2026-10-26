import { Context, Effect, Layer } from 'effect';
import { type CostServiceImpl } from '../../telemetry/cost-service';
import { type ExtensionInfoEventProcessor } from '../../telemetry/extension-info-processor';
import { type FrictionAnalysisServiceImpl } from '../../telemetry/friction-analysis';
import { type FrictionRecallClientImpl } from '../../telemetry/friction-recall-client';
import { type HostIDEInfoEventProcessor } from '../../telemetry/host-ide-info-processor';
import { type PluginTelemetryServiceImpl } from '../../telemetry/plugin-telemetry-service';
import { type EnvQimeiDetector } from '../../telemetry/qimei-env-detector';
import { type SandboxTelemetryReporterImpl } from '../../telemetry/sandbox-telemetry-service';
import { type StartupProfilerImpl } from '../../telemetry/startup-profiler';
import { type PluginStatusServiceImpl } from '../../telemetry/status-reporter';
import { type TelemetryClientInfoEventProcessor } from '../../telemetry/telemetry-client-info-event-processor';
import { type TelemetryServiceImpl } from '../../telemetry/telemetry-service';
import { type VCSEventProcessor } from '../../telemetry/vcs-event-processor';
declare const CostServiceImplKey_base: Context.ServiceClass<CostServiceImplKey, "server/native/CostServiceImpl", CostServiceImpl>;
export declare class CostServiceImplKey extends CostServiceImplKey_base {
}
export declare const CostServiceImplLayer: Layer.Layer<CostServiceImplKey, never, never>;
declare const ExtensionInfoEventProcessorKey_base: Context.ServiceClass<ExtensionInfoEventProcessorKey, "server/native/ExtensionInfoEventProcessor", ExtensionInfoEventProcessor>;
export declare class ExtensionInfoEventProcessorKey extends ExtensionInfoEventProcessorKey_base {
}
export declare const ExtensionInfoEventProcessorLayer: Layer.Layer<ExtensionInfoEventProcessorKey, never, never>;
declare const FrictionRecallClientImplKey_base: Context.ServiceClass<FrictionRecallClientImplKey, "server/native/FrictionRecallClientImpl", FrictionRecallClientImpl>;
export declare class FrictionRecallClientImplKey extends FrictionRecallClientImplKey_base {
}
export declare const FrictionRecallClientImplLayer: Layer.Layer<FrictionRecallClientImplKey, never, never>;
declare const FrictionAnalysisServiceImplKey_base: Context.ServiceClass<FrictionAnalysisServiceImplKey, "server/native/FrictionAnalysisServiceImpl", FrictionAnalysisServiceImpl>;
export declare class FrictionAnalysisServiceImplKey extends FrictionAnalysisServiceImplKey_base {
}
export declare const FrictionAnalysisServiceImplLayer: Layer.Layer<FrictionAnalysisServiceImplKey, never, never>;
declare const HostIDEInfoEventProcessorKey_base: Context.ServiceClass<HostIDEInfoEventProcessorKey, "server/native/HostIDEInfoEventProcessor", HostIDEInfoEventProcessor>;
export declare class HostIDEInfoEventProcessorKey extends HostIDEInfoEventProcessorKey_base {
}
export declare const HostIDEInfoEventProcessorLayer: Layer.Layer<HostIDEInfoEventProcessorKey, never, never>;
declare const PluginTelemetryServiceImplKey_base: Context.ServiceClass<PluginTelemetryServiceImplKey, "server/native/PluginTelemetryServiceImpl", PluginTelemetryServiceImpl>;
export declare class PluginTelemetryServiceImplKey extends PluginTelemetryServiceImplKey_base {
}
export declare const PluginTelemetryServiceImplLayer: Layer.Layer<PluginTelemetryServiceImplKey, never, never>;
declare const EnvQimeiDetectorKey_base: Context.ServiceClass<EnvQimeiDetectorKey, "server/native/EnvQimeiDetector", EnvQimeiDetector>;
export declare class EnvQimeiDetectorKey extends EnvQimeiDetectorKey_base {
}
export declare const EnvQimeiDetectorLayer: Layer.Layer<EnvQimeiDetectorKey, never, never>;
declare const SandboxTelemetryReporterImplKey_base: Context.ServiceClass<SandboxTelemetryReporterImplKey, "server/native/SandboxTelemetryReporterImpl", SandboxTelemetryReporterImpl>;
export declare class SandboxTelemetryReporterImplKey extends SandboxTelemetryReporterImplKey_base {
}
export declare const SandboxTelemetryReporterImplLayer: Layer.Layer<SandboxTelemetryReporterImplKey, never, never>;
declare const StartupProfilerImplKey_base: Context.ServiceClass<StartupProfilerImplKey, "server/native/StartupProfilerImpl", StartupProfilerImpl>;
export declare class StartupProfilerImplKey extends StartupProfilerImplKey_base {
}
export declare const StartupProfilerImplLayer: Layer.Layer<StartupProfilerImplKey, never, never>;
declare const PluginStatusServiceImplKey_base: Context.ServiceClass<PluginStatusServiceImplKey, "server/native/PluginStatusServiceImpl", PluginStatusServiceImpl>;
export declare class PluginStatusServiceImplKey extends PluginStatusServiceImplKey_base {
}
export declare const PluginStatusServiceImplLayer: Layer.Layer<PluginStatusServiceImplKey, never, never>;
declare const TelemetryClientInfoEventProcessorKey_base: Context.ServiceClass<TelemetryClientInfoEventProcessorKey, "server/native/TelemetryClientInfoEventProcessor", TelemetryClientInfoEventProcessor>;
export declare class TelemetryClientInfoEventProcessorKey extends TelemetryClientInfoEventProcessorKey_base {
}
export declare const TelemetryClientInfoEventProcessorLayer: Layer.Layer<TelemetryClientInfoEventProcessorKey, never, never>;
declare const TelemetryServiceImplKey_base: Context.ServiceClass<TelemetryServiceImplKey, "server/native/TelemetryServiceImpl", TelemetryServiceImpl>;
export declare class TelemetryServiceImplKey extends TelemetryServiceImplKey_base {
}
export declare const TelemetryServiceImplLayer: Layer.Layer<TelemetryServiceImplKey, never, never>;
declare const VCSEventProcessorKey_base: Context.ServiceClass<VCSEventProcessorKey, "server/native/VCSEventProcessor", VCSEventProcessor>;
export declare class VCSEventProcessorKey extends VCSEventProcessorKey_base {
}
export declare const VCSEventProcessorLayer: Layer.Layer<VCSEventProcessorKey, never, never>;
export declare const layer: Layer.Layer<CostServiceImplKey | ExtensionInfoEventProcessorKey | FrictionRecallClientImplKey | FrictionAnalysisServiceImplKey | HostIDEInfoEventProcessorKey | PluginTelemetryServiceImplKey | EnvQimeiDetectorKey | SandboxTelemetryReporterImplKey | StartupProfilerImplKey | PluginStatusServiceImplKey | TelemetryClientInfoEventProcessorKey | TelemetryServiceImplKey | VCSEventProcessorKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof CostServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof ExtensionInfoEventProcessorKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof FrictionRecallClientImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof FrictionAnalysisServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof HostIDEInfoEventProcessorKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof PluginTelemetryServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof EnvQimeiDetectorKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SandboxTelemetryReporterImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof StartupProfilerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof PluginStatusServiceImplKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof TelemetryClientInfoEventProcessorKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof TelemetryServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof VCSEventProcessorKey;
    mode: "add";
})[];
export declare const warmup: Effect.Effect<void, never, CostServiceImplKey | ExtensionInfoEventProcessorKey | FrictionRecallClientImplKey | FrictionAnalysisServiceImplKey | HostIDEInfoEventProcessorKey | PluginTelemetryServiceImplKey | EnvQimeiDetectorKey | SandboxTelemetryReporterImplKey | StartupProfilerImplKey | PluginStatusServiceImplKey | TelemetryClientInfoEventProcessorKey | TelemetryServiceImplKey | VCSEventProcessorKey>;
export declare const deps: ReadonlyArray<string>;
export {};
