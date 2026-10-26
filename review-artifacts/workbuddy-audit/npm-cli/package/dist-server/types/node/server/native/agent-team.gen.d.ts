import { Context, Effect, Layer } from 'effect';
import { InProcessTeammateBackend } from '../../agent-team/backends/in-process-backend';
import { type TeamCleanupServiceImpl } from '../../agent-team/team-cleanup-service';
import { type TeamInboxDispatchServiceImpl } from '../../agent-team/team-inbox-dispatch-service';
import { type TeamMailboxImpl } from '../../agent-team/team-mailbox';
import { type TeamManagerImpl } from '../../agent-team/team-manager';
import { type TeammateIdleTrackerImpl } from '../../agent-team/teammate-idle-tracker';
import { type TeammateMailboxLifecycle } from '../../agent-team/teammate-runner';
declare const InProcessTeammateBackendKey_base: Context.ServiceClass<InProcessTeammateBackendKey, "server/native/InProcessTeammateBackend", InProcessTeammateBackend>;
export declare class InProcessTeammateBackendKey extends InProcessTeammateBackendKey_base {
}
export declare const InProcessTeammateBackendLayer: Layer.Layer<InProcessTeammateBackendKey, never, never>;
declare const TeamCleanupServiceImplKey_base: Context.ServiceClass<TeamCleanupServiceImplKey, "server/native/TeamCleanupServiceImpl", TeamCleanupServiceImpl>;
export declare class TeamCleanupServiceImplKey extends TeamCleanupServiceImplKey_base {
}
export declare const TeamCleanupServiceImplLayer: Layer.Layer<TeamCleanupServiceImplKey, never, never>;
declare const TeamInboxDispatchServiceImplKey_base: Context.ServiceClass<TeamInboxDispatchServiceImplKey, "server/native/TeamInboxDispatchServiceImpl", TeamInboxDispatchServiceImpl>;
export declare class TeamInboxDispatchServiceImplKey extends TeamInboxDispatchServiceImplKey_base {
}
export declare const TeamInboxDispatchServiceImplLayer: Layer.Layer<TeamInboxDispatchServiceImplKey, never, never>;
declare const TeamMailboxImplKey_base: Context.ServiceClass<TeamMailboxImplKey, "server/native/TeamMailboxImpl", TeamMailboxImpl>;
export declare class TeamMailboxImplKey extends TeamMailboxImplKey_base {
}
export declare const TeamMailboxImplLayer: Layer.Layer<TeamMailboxImplKey, never, never>;
declare const TeamManagerImplKey_base: Context.ServiceClass<TeamManagerImplKey, "server/native/TeamManagerImpl", TeamManagerImpl>;
export declare class TeamManagerImplKey extends TeamManagerImplKey_base {
}
export declare const TeamManagerImplLayer: Layer.Layer<TeamManagerImplKey, never, never>;
declare const TeammateIdleTrackerImplKey_base: Context.ServiceClass<TeammateIdleTrackerImplKey, "server/native/TeammateIdleTrackerImpl", TeammateIdleTrackerImpl>;
export declare class TeammateIdleTrackerImplKey extends TeammateIdleTrackerImplKey_base {
}
export declare const TeammateIdleTrackerImplLayer: Layer.Layer<TeammateIdleTrackerImplKey, never, never>;
declare const TeammateMailboxLifecycleKey_base: Context.ServiceClass<TeammateMailboxLifecycleKey, "server/native/TeammateMailboxLifecycle", TeammateMailboxLifecycle>;
export declare class TeammateMailboxLifecycleKey extends TeammateMailboxLifecycleKey_base {
}
export declare const TeammateMailboxLifecycleLayer: Layer.Layer<TeammateMailboxLifecycleKey, never, never>;
export declare const layer: Layer.Layer<InProcessTeammateBackendKey | TeamCleanupServiceImplKey | TeamInboxDispatchServiceImplKey | TeamMailboxImplKey | TeamManagerImplKey | TeammateIdleTrackerImplKey | TeammateMailboxLifecycleKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof InProcessTeammateBackendKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof TeamCleanupServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof TeamInboxDispatchServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof TeamMailboxImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof TeamManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof TeammateIdleTrackerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof TeammateMailboxLifecycleKey;
    mode: "add";
})[];
export declare const warmup: Effect.Effect<void, never, InProcessTeammateBackendKey | TeamCleanupServiceImplKey | TeamInboxDispatchServiceImplKey | TeamMailboxImplKey | TeamManagerImplKey | TeammateIdleTrackerImplKey | TeammateMailboxLifecycleKey>;
export declare const deps: ReadonlyArray<string>;
export {};
