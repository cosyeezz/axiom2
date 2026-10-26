import { Context, Effect, Layer } from 'effect';
import { NotificationInjectionBufferImpl, RichMessageQueueManagerImpl, SteerInputBufferImpl } from '../../../vendor/cbc-core/node/index.js';
declare const NotificationInjectionBufferImplKey_base: Context.ServiceClass<NotificationInjectionBufferImplKey, "server/native/NotificationInjectionBufferImpl", NotificationInjectionBufferImpl>;
export declare class NotificationInjectionBufferImplKey extends NotificationInjectionBufferImplKey_base {
}
export declare const NotificationInjectionBufferImplLayer: Layer.Layer<NotificationInjectionBufferImplKey, never, never>;
declare const RichMessageQueueManagerImplKey_base: Context.ServiceClass<RichMessageQueueManagerImplKey, "server/native/RichMessageQueueManagerImpl", RichMessageQueueManagerImpl>;
export declare class RichMessageQueueManagerImplKey extends RichMessageQueueManagerImplKey_base {
}
export declare const RichMessageQueueManagerImplLayer: Layer.Layer<RichMessageQueueManagerImplKey, never, never>;
declare const SteerInputBufferImplKey_base: Context.ServiceClass<SteerInputBufferImplKey, "server/native/SteerInputBufferImpl", SteerInputBufferImpl>;
export declare class SteerInputBufferImplKey extends SteerInputBufferImplKey_base {
}
export declare const SteerInputBufferImplLayer: Layer.Layer<SteerInputBufferImplKey, never, never>;
export declare const layer: Layer.Layer<NotificationInjectionBufferImplKey | RichMessageQueueManagerImplKey | SteerInputBufferImplKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof NotificationInjectionBufferImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof RichMessageQueueManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SteerInputBufferImplKey;
    mode: "rebind";
})[];
export declare const warmup: Effect.Effect<void, never, NotificationInjectionBufferImplKey | RichMessageQueueManagerImplKey | SteerInputBufferImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
