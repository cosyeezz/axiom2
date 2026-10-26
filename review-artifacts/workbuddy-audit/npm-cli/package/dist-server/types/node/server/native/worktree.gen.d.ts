import { CwdServiceImpl, TmuxServiceImpl, WorktreeChangeDetectorImpl, WorktreeInitializerImpl, WorktreeNameGeneratorImpl, WorktreePRParserImpl, WorktreeServiceImpl, WorktreeSessionManagerImpl } from '@genie/cbc-worktree';
import { Context, Effect, Layer } from 'effect';
declare const CwdServiceImplKey_base: Context.ServiceClass<CwdServiceImplKey, "server/native/CwdServiceImpl", CwdServiceImpl>;
export declare class CwdServiceImplKey extends CwdServiceImplKey_base {
}
export declare const CwdServiceImplLayer: Layer.Layer<CwdServiceImplKey, never, never>;
declare const TmuxServiceImplKey_base: Context.ServiceClass<TmuxServiceImplKey, "server/native/TmuxServiceImpl", TmuxServiceImpl>;
export declare class TmuxServiceImplKey extends TmuxServiceImplKey_base {
}
export declare const TmuxServiceImplLayer: Layer.Layer<TmuxServiceImplKey, never, never>;
declare const WorktreeChangeDetectorImplKey_base: Context.ServiceClass<WorktreeChangeDetectorImplKey, "server/native/WorktreeChangeDetectorImpl", WorktreeChangeDetectorImpl>;
export declare class WorktreeChangeDetectorImplKey extends WorktreeChangeDetectorImplKey_base {
}
export declare const WorktreeChangeDetectorImplLayer: Layer.Layer<WorktreeChangeDetectorImplKey, never, never>;
declare const WorktreeInitializerImplKey_base: Context.ServiceClass<WorktreeInitializerImplKey, "server/native/WorktreeInitializerImpl", WorktreeInitializerImpl>;
export declare class WorktreeInitializerImplKey extends WorktreeInitializerImplKey_base {
}
export declare const WorktreeInitializerImplLayer: Layer.Layer<WorktreeInitializerImplKey, never, never>;
declare const WorktreeNameGeneratorImplKey_base: Context.ServiceClass<WorktreeNameGeneratorImplKey, "server/native/WorktreeNameGeneratorImpl", WorktreeNameGeneratorImpl>;
export declare class WorktreeNameGeneratorImplKey extends WorktreeNameGeneratorImplKey_base {
}
export declare const WorktreeNameGeneratorImplLayer: Layer.Layer<WorktreeNameGeneratorImplKey, never, never>;
declare const WorktreePRParserImplKey_base: Context.ServiceClass<WorktreePRParserImplKey, "server/native/WorktreePRParserImpl", WorktreePRParserImpl>;
export declare class WorktreePRParserImplKey extends WorktreePRParserImplKey_base {
}
export declare const WorktreePRParserImplLayer: Layer.Layer<WorktreePRParserImplKey, never, never>;
declare const WorktreeServiceImplKey_base: Context.ServiceClass<WorktreeServiceImplKey, "server/native/WorktreeServiceImpl", WorktreeServiceImpl>;
export declare class WorktreeServiceImplKey extends WorktreeServiceImplKey_base {
}
export declare const WorktreeServiceImplLayer: Layer.Layer<WorktreeServiceImplKey, never, never>;
declare const WorktreeSessionManagerImplKey_base: Context.ServiceClass<WorktreeSessionManagerImplKey, "server/native/WorktreeSessionManagerImpl", WorktreeSessionManagerImpl>;
export declare class WorktreeSessionManagerImplKey extends WorktreeSessionManagerImplKey_base {
}
export declare const WorktreeSessionManagerImplLayer: Layer.Layer<WorktreeSessionManagerImplKey, never, never>;
export declare const layer: Layer.Layer<CwdServiceImplKey | TmuxServiceImplKey | WorktreeChangeDetectorImplKey | WorktreeInitializerImplKey | WorktreeNameGeneratorImplKey | WorktreePRParserImplKey | WorktreeServiceImplKey | WorktreeSessionManagerImplKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof CwdServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof TmuxServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof WorktreeChangeDetectorImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof WorktreeInitializerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof WorktreeNameGeneratorImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof WorktreePRParserImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof WorktreeServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof WorktreeSessionManagerImplKey;
    mode: "rebind";
})[];
export declare const warmup: Effect.Effect<void, never, CwdServiceImplKey | TmuxServiceImplKey | WorktreeChangeDetectorImplKey | WorktreeInitializerImplKey | WorktreeNameGeneratorImplKey | WorktreePRParserImplKey | WorktreeServiceImplKey | WorktreeSessionManagerImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
