import { Context, Effect, Layer } from 'effect';
import { ProgressSyncServiceImpl } from '../../notification/progress-sync-service';
import { TerminalNotificationServiceImpl } from '../../notification/terminal-notification-service';
declare const ProgressSyncServiceImplKey_base: Context.ServiceClass<ProgressSyncServiceImplKey, "server/native/ProgressSyncServiceImpl", ProgressSyncServiceImpl>;
export declare class ProgressSyncServiceImplKey extends ProgressSyncServiceImplKey_base {
}
export declare const ProgressSyncServiceImplLayer: Layer.Layer<ProgressSyncServiceImplKey, never, never>;
declare const TerminalNotificationServiceImplKey_base: Context.ServiceClass<TerminalNotificationServiceImplKey, "server/native/TerminalNotificationServiceImpl", TerminalNotificationServiceImpl>;
export declare class TerminalNotificationServiceImplKey extends TerminalNotificationServiceImplKey_base {
}
export declare const TerminalNotificationServiceImplLayer: Layer.Layer<TerminalNotificationServiceImplKey, never, never>;
export declare const layer: Layer.Layer<ProgressSyncServiceImplKey | TerminalNotificationServiceImplKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof ProgressSyncServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof TerminalNotificationServiceImplKey;
    mode: "rebind";
})[];
export declare const warmup: Effect.Effect<void, never, ProgressSyncServiceImplKey | TerminalNotificationServiceImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
