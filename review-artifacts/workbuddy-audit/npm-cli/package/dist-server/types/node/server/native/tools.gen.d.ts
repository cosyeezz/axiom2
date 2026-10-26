import { Context, Effect, Layer } from 'effect';
import { AutoModeClassifierClientImpl } from '../../tools/auto-mode/auto-mode-classifier-client';
import { AutoModeDenialTrackerImpl } from '../../tools/auto-mode/auto-mode-denial-tracker';
import { AutoModePermissionServiceImpl } from '../../tools/auto-mode/auto-mode-permission-service';
import { AutoModeProjectInstructionsResolverImpl } from '../../tools/auto-mode/auto-mode-project-instructions';
import { AutoModeSettingsResolverImpl } from '../../tools/auto-mode/auto-mode-settings';
import { AutoModeSystemPromptBuilderImpl } from '../../tools/auto-mode/auto-mode-system-prompt-builder';
import { AutoModeTranscriptLimitImpl } from '../../tools/auto-mode/auto-mode-transcript-limit';
import { BriefModeServiceImpl } from '../../tools/brief-mode-service';
import { DeferToolConfigServiceImpl } from '../../tools/defer-tool-config-service';
import { DeferredToolBridge } from '../../tools/deferred-tool-bridge';
import { ImageServiceImpl } from '../../tools/image-service';
import { PlanStorageServiceImpl } from '../../tools/plan-storage-service';
import { ReadFileStateServiceImpl } from '../../tools/read-file-state-service';
import { SandboxWriteRuleGuardImpl } from '../../tools/sandbox-write-rule-guard';
import { TaskStorageServiceImpl } from '../../tools/task-storage-service';
import { TodoStorageServiceImpl } from '../../tools/todo-storage-service';
import { ToolAlwaysApprovalServiceImpl } from '../../tools/tool-always-approval-service';
import { ToolArgumentRewriteServiceImpl } from '../../tools/tool-argument-rewrite-service';
import { ToolHookManagerImpl } from '../../tools/tool-hook-manager';
import { ToolManagerImpl } from '../../tools/tool-manager';
import { ToolPermissionServiceImpl } from '../../tools/tool-permission-service';
import { ToolSearchServiceImpl } from '../../tools/tool-search-service';
import { AgentToolDeferOverlayCacheImpl } from '../../tools/tool-spec/agent-tool-defer-overlay-cache';
import { VideoServiceImpl } from '../../tools/video-service';
declare const AutoModeSystemPromptBuilderImplKey_base: Context.ServiceClass<AutoModeSystemPromptBuilderImplKey, "server/native/AutoModeSystemPromptBuilderImpl", AutoModeSystemPromptBuilderImpl>;
export declare class AutoModeSystemPromptBuilderImplKey extends AutoModeSystemPromptBuilderImplKey_base {
}
export declare const AutoModeSystemPromptBuilderImplLayer: Layer.Layer<AutoModeSystemPromptBuilderImplKey, never, never>;
declare const AutoModeTranscriptLimitImplKey_base: Context.ServiceClass<AutoModeTranscriptLimitImplKey, "server/native/AutoModeTranscriptLimitImpl", AutoModeTranscriptLimitImpl>;
export declare class AutoModeTranscriptLimitImplKey extends AutoModeTranscriptLimitImplKey_base {
}
export declare const AutoModeTranscriptLimitImplLayer: Layer.Layer<AutoModeTranscriptLimitImplKey, never, never>;
declare const AutoModeClassifierClientImplKey_base: Context.ServiceClass<AutoModeClassifierClientImplKey, "server/native/AutoModeClassifierClientImpl", AutoModeClassifierClientImpl>;
export declare class AutoModeClassifierClientImplKey extends AutoModeClassifierClientImplKey_base {
}
export declare const AutoModeClassifierClientImplLayer: Layer.Layer<AutoModeClassifierClientImplKey, never, never>;
declare const AutoModeDenialTrackerImplKey_base: Context.ServiceClass<AutoModeDenialTrackerImplKey, "server/native/AutoModeDenialTrackerImpl", AutoModeDenialTrackerImpl>;
export declare class AutoModeDenialTrackerImplKey extends AutoModeDenialTrackerImplKey_base {
}
export declare const AutoModeDenialTrackerImplLayer: Layer.Layer<AutoModeDenialTrackerImplKey, never, never>;
declare const AutoModeSettingsResolverImplKey_base: Context.ServiceClass<AutoModeSettingsResolverImplKey, "server/native/AutoModeSettingsResolverImpl", AutoModeSettingsResolverImpl>;
export declare class AutoModeSettingsResolverImplKey extends AutoModeSettingsResolverImplKey_base {
}
export declare const AutoModeSettingsResolverImplLayer: Layer.Layer<AutoModeSettingsResolverImplKey, never, never>;
declare const AutoModeProjectInstructionsResolverImplKey_base: Context.ServiceClass<AutoModeProjectInstructionsResolverImplKey, "server/native/AutoModeProjectInstructionsResolverImpl", AutoModeProjectInstructionsResolverImpl>;
export declare class AutoModeProjectInstructionsResolverImplKey extends AutoModeProjectInstructionsResolverImplKey_base {
}
export declare const AutoModeProjectInstructionsResolverImplLayer: Layer.Layer<AutoModeProjectInstructionsResolverImplKey, never, never>;
declare const AutoModePermissionServiceImplKey_base: Context.ServiceClass<AutoModePermissionServiceImplKey, "server/native/AutoModePermissionServiceImpl", AutoModePermissionServiceImpl>;
export declare class AutoModePermissionServiceImplKey extends AutoModePermissionServiceImplKey_base {
}
export declare const AutoModePermissionServiceImplLayer: Layer.Layer<AutoModePermissionServiceImplKey, never, never>;
declare const BriefModeServiceImplKey_base: Context.ServiceClass<BriefModeServiceImplKey, "server/native/BriefModeServiceImpl", BriefModeServiceImpl>;
export declare class BriefModeServiceImplKey extends BriefModeServiceImplKey_base {
}
export declare const BriefModeServiceImplLayer: Layer.Layer<BriefModeServiceImplKey, never, never>;
declare const DeferToolConfigServiceImplKey_base: Context.ServiceClass<DeferToolConfigServiceImplKey, "server/native/DeferToolConfigServiceImpl", DeferToolConfigServiceImpl>;
export declare class DeferToolConfigServiceImplKey extends DeferToolConfigServiceImplKey_base {
}
export declare const DeferToolConfigServiceImplLayer: Layer.Layer<DeferToolConfigServiceImplKey, never, never>;
declare const DeferredToolBridgeKey_base: Context.ServiceClass<DeferredToolBridgeKey, "server/native/DeferredToolBridge", DeferredToolBridge>;
export declare class DeferredToolBridgeKey extends DeferredToolBridgeKey_base {
}
export declare const DeferredToolBridgeLayer: Layer.Layer<DeferredToolBridgeKey, never, never>;
declare const ImageServiceImplKey_base: Context.ServiceClass<ImageServiceImplKey, "server/native/ImageServiceImpl", ImageServiceImpl>;
export declare class ImageServiceImplKey extends ImageServiceImplKey_base {
}
export declare const ImageServiceImplLayer: Layer.Layer<ImageServiceImplKey, never, never>;
declare const PlanStorageServiceImplKey_base: Context.ServiceClass<PlanStorageServiceImplKey, "server/native/PlanStorageServiceImpl", PlanStorageServiceImpl>;
export declare class PlanStorageServiceImplKey extends PlanStorageServiceImplKey_base {
}
export declare const PlanStorageServiceImplLayer: Layer.Layer<PlanStorageServiceImplKey, never, never>;
declare const ReadFileStateServiceImplKey_base: Context.ServiceClass<ReadFileStateServiceImplKey, "server/native/ReadFileStateServiceImpl", ReadFileStateServiceImpl>;
export declare class ReadFileStateServiceImplKey extends ReadFileStateServiceImplKey_base {
}
export declare const ReadFileStateServiceImplLayer: Layer.Layer<ReadFileStateServiceImplKey, never, never>;
declare const SandboxWriteRuleGuardImplKey_base: Context.ServiceClass<SandboxWriteRuleGuardImplKey, "server/native/SandboxWriteRuleGuardImpl", SandboxWriteRuleGuardImpl>;
export declare class SandboxWriteRuleGuardImplKey extends SandboxWriteRuleGuardImplKey_base {
}
export declare const SandboxWriteRuleGuardImplLayer: Layer.Layer<SandboxWriteRuleGuardImplKey, never, never>;
declare const TaskStorageServiceImplKey_base: Context.ServiceClass<TaskStorageServiceImplKey, "server/native/TaskStorageServiceImpl", TaskStorageServiceImpl>;
export declare class TaskStorageServiceImplKey extends TaskStorageServiceImplKey_base {
}
export declare const TaskStorageServiceImplLayer: Layer.Layer<TaskStorageServiceImplKey, never, never>;
declare const TodoStorageServiceImplKey_base: Context.ServiceClass<TodoStorageServiceImplKey, "server/native/TodoStorageServiceImpl", TodoStorageServiceImpl>;
export declare class TodoStorageServiceImplKey extends TodoStorageServiceImplKey_base {
}
export declare const TodoStorageServiceImplLayer: Layer.Layer<TodoStorageServiceImplKey, never, never>;
declare const ToolAlwaysApprovalServiceImplKey_base: Context.ServiceClass<ToolAlwaysApprovalServiceImplKey, "server/native/ToolAlwaysApprovalServiceImpl", ToolAlwaysApprovalServiceImpl>;
export declare class ToolAlwaysApprovalServiceImplKey extends ToolAlwaysApprovalServiceImplKey_base {
}
export declare const ToolAlwaysApprovalServiceImplLayer: Layer.Layer<ToolAlwaysApprovalServiceImplKey, never, never>;
declare const ToolArgumentRewriteServiceImplKey_base: Context.ServiceClass<ToolArgumentRewriteServiceImplKey, "server/native/ToolArgumentRewriteServiceImpl", ToolArgumentRewriteServiceImpl>;
export declare class ToolArgumentRewriteServiceImplKey extends ToolArgumentRewriteServiceImplKey_base {
}
export declare const ToolArgumentRewriteServiceImplLayer: Layer.Layer<ToolArgumentRewriteServiceImplKey, never, never>;
declare const ToolHookManagerImplKey_base: Context.ServiceClass<ToolHookManagerImplKey, "server/native/ToolHookManagerImpl", ToolHookManagerImpl>;
export declare class ToolHookManagerImplKey extends ToolHookManagerImplKey_base {
}
export declare const ToolHookManagerImplLayer: Layer.Layer<ToolHookManagerImplKey, never, never>;
declare const ToolSearchServiceImplKey_base: Context.ServiceClass<ToolSearchServiceImplKey, "server/native/ToolSearchServiceImpl", ToolSearchServiceImpl>;
export declare class ToolSearchServiceImplKey extends ToolSearchServiceImplKey_base {
}
export declare const ToolSearchServiceImplLayer: Layer.Layer<ToolSearchServiceImplKey, never, never>;
declare const ToolManagerImplKey_base: Context.ServiceClass<ToolManagerImplKey, "server/native/ToolManagerImpl", ToolManagerImpl>;
export declare class ToolManagerImplKey extends ToolManagerImplKey_base {
}
export declare const ToolManagerImplLayer: Layer.Layer<ToolManagerImplKey, never, never>;
declare const ToolPermissionServiceImplKey_base: Context.ServiceClass<ToolPermissionServiceImplKey, "server/native/ToolPermissionServiceImpl", ToolPermissionServiceImpl>;
export declare class ToolPermissionServiceImplKey extends ToolPermissionServiceImplKey_base {
}
export declare const ToolPermissionServiceImplLayer: Layer.Layer<ToolPermissionServiceImplKey, never, never>;
declare const AgentToolDeferOverlayCacheImplKey_base: Context.ServiceClass<AgentToolDeferOverlayCacheImplKey, "server/native/AgentToolDeferOverlayCacheImpl", AgentToolDeferOverlayCacheImpl>;
export declare class AgentToolDeferOverlayCacheImplKey extends AgentToolDeferOverlayCacheImplKey_base {
}
export declare const AgentToolDeferOverlayCacheImplLayer: Layer.Layer<AgentToolDeferOverlayCacheImplKey, never, never>;
declare const VideoServiceImplKey_base: Context.ServiceClass<VideoServiceImplKey, "server/native/VideoServiceImpl", VideoServiceImpl>;
export declare class VideoServiceImplKey extends VideoServiceImplKey_base {
}
export declare const VideoServiceImplLayer: Layer.Layer<VideoServiceImplKey, never, never>;
export declare const layer: Layer.Layer<AutoModeSystemPromptBuilderImplKey | AutoModeTranscriptLimitImplKey | AutoModeClassifierClientImplKey | AutoModeDenialTrackerImplKey | AutoModeSettingsResolverImplKey | AutoModeProjectInstructionsResolverImplKey | AutoModePermissionServiceImplKey | BriefModeServiceImplKey | DeferToolConfigServiceImplKey | DeferredToolBridgeKey | ImageServiceImplKey | PlanStorageServiceImplKey | ReadFileStateServiceImplKey | SandboxWriteRuleGuardImplKey | TaskStorageServiceImplKey | TodoStorageServiceImplKey | ToolAlwaysApprovalServiceImplKey | ToolArgumentRewriteServiceImplKey | ToolHookManagerImplKey | ToolSearchServiceImplKey | ToolManagerImplKey | ToolPermissionServiceImplKey | AgentToolDeferOverlayCacheImplKey | VideoServiceImplKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof AutoModeSystemPromptBuilderImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof AutoModeTranscriptLimitImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof AutoModeClassifierClientImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof AutoModeDenialTrackerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof AutoModeSettingsResolverImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof AutoModeProjectInstructionsResolverImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof AutoModePermissionServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof BriefModeServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof DeferToolConfigServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof DeferredToolBridgeKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof ImageServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof PlanStorageServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof ReadFileStateServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof ReadFileStateServiceImplKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof SandboxWriteRuleGuardImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof TaskStorageServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof TodoStorageServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof ToolAlwaysApprovalServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof ToolArgumentRewriteServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof ToolHookManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof ToolSearchServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof ToolManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof ToolPermissionServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof AgentToolDeferOverlayCacheImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof VideoServiceImplKey;
    mode: "rebind";
})[];
export declare const warmup: Effect.Effect<void, never, AutoModeSystemPromptBuilderImplKey | AutoModeTranscriptLimitImplKey | AutoModeClassifierClientImplKey | AutoModeDenialTrackerImplKey | AutoModeSettingsResolverImplKey | AutoModeProjectInstructionsResolverImplKey | AutoModePermissionServiceImplKey | BriefModeServiceImplKey | DeferToolConfigServiceImplKey | DeferredToolBridgeKey | ImageServiceImplKey | PlanStorageServiceImplKey | ReadFileStateServiceImplKey | SandboxWriteRuleGuardImplKey | TaskStorageServiceImplKey | TodoStorageServiceImplKey | ToolAlwaysApprovalServiceImplKey | ToolArgumentRewriteServiceImplKey | ToolHookManagerImplKey | ToolSearchServiceImplKey | ToolManagerImplKey | ToolPermissionServiceImplKey | AgentToolDeferOverlayCacheImplKey | VideoServiceImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
