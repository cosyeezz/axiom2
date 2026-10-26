import { Context, Effect, Layer } from 'effect';
import { type DelegatingShellService } from '../../shell/delegating-shell-service';
import { type DriverShellServiceImpl } from '../../shell/driver-shell-service';
import { type ShellServiceImpl } from '../../shell/shell-service';
import { type ShellSnapshotServiceImpl } from '../../shell/shell-snapshot-service';
declare const ShellSnapshotServiceImplKey_base: Context.ServiceClass<ShellSnapshotServiceImplKey, "server/native/ShellSnapshotServiceImpl", ShellSnapshotServiceImpl>;
export declare class ShellSnapshotServiceImplKey extends ShellSnapshotServiceImplKey_base {
}
export declare const ShellSnapshotServiceImplLayer: Layer.Layer<ShellSnapshotServiceImplKey, never, never>;
declare const ShellServiceImplKey_base: Context.ServiceClass<ShellServiceImplKey, "server/native/ShellServiceImpl", ShellServiceImpl>;
export declare class ShellServiceImplKey extends ShellServiceImplKey_base {
}
export declare const ShellServiceImplLayer: Layer.Layer<ShellServiceImplKey, never, never>;
declare const DelegatingShellServiceKey_base: Context.ServiceClass<DelegatingShellServiceKey, "server/native/DelegatingShellService", DelegatingShellService>;
export declare class DelegatingShellServiceKey extends DelegatingShellServiceKey_base {
}
export declare const DelegatingShellServiceLayer: Layer.Layer<DelegatingShellServiceKey, never, never>;
declare const DriverShellServiceImplKey_base: Context.ServiceClass<DriverShellServiceImplKey, "server/native/DriverShellServiceImpl", DriverShellServiceImpl>;
export declare class DriverShellServiceImplKey extends DriverShellServiceImplKey_base {
}
export declare const DriverShellServiceImplLayer: Layer.Layer<DriverShellServiceImplKey, never, never>;
export declare const layer: Layer.Layer<ShellSnapshotServiceImplKey | ShellServiceImplKey | DelegatingShellServiceKey | DriverShellServiceImplKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof ShellSnapshotServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof ShellServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof DelegatingShellServiceKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof DriverShellServiceImplKey;
    mode: "rebind";
})[];
export declare const warmup: Effect.Effect<void, never, ShellSnapshotServiceImplKey | ShellServiceImplKey | DelegatingShellServiceKey | DriverShellServiceImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
