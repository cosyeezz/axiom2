import { Context, Effect, Layer } from 'effect';
import { SessionHistoryCleanServiceImpl } from '../../session/session-history-clean-service';
import { IdleQueueDrainServiceImpl, InterruptionServiceImpl, MessageQueueManagerImpl, SessionFactoryImpl, SessionHookManagerImpl, SessionManagerImpl, SessionRunStateMachineImpl, SessionStoreImpl } from '../../../vendor/cbc-core/node/index.js';
declare const SessionHistoryCleanServiceImplKey_base: Context.ServiceClass<SessionHistoryCleanServiceImplKey, "server/native/SessionHistoryCleanServiceImpl", SessionHistoryCleanServiceImpl>;
export declare class SessionHistoryCleanServiceImplKey extends SessionHistoryCleanServiceImplKey_base {
}
export declare const SessionHistoryCleanServiceImplLayer: Layer.Layer<SessionHistoryCleanServiceImplKey, never, never>;
declare const IdleQueueDrainServiceImplKey_base: Context.ServiceClass<IdleQueueDrainServiceImplKey, "server/native/IdleQueueDrainServiceImpl", IdleQueueDrainServiceImpl>;
export declare class IdleQueueDrainServiceImplKey extends IdleQueueDrainServiceImplKey_base {
}
export declare const IdleQueueDrainServiceImplLayer: Layer.Layer<IdleQueueDrainServiceImplKey, never, never>;
declare const SessionFactoryImplKey_base: Context.ServiceClass<SessionFactoryImplKey, "server/native/SessionFactoryImpl", SessionFactoryImpl>;
export declare class SessionFactoryImplKey extends SessionFactoryImplKey_base {
}
export declare const SessionFactoryImplLayer: Layer.Layer<SessionFactoryImplKey, never, never>;
declare const SessionStoreImplKey_base: Context.ServiceClass<SessionStoreImplKey, "server/native/SessionStoreImpl", SessionStoreImpl>;
export declare class SessionStoreImplKey extends SessionStoreImplKey_base {
}
export declare const SessionStoreImplLayer: Layer.Layer<SessionStoreImplKey, never, never>;
declare const SessionHookManagerImplKey_base: Context.ServiceClass<SessionHookManagerImplKey, "server/native/SessionHookManagerImpl", SessionHookManagerImpl>;
export declare class SessionHookManagerImplKey extends SessionHookManagerImplKey_base {
}
export declare const SessionHookManagerImplLayer: Layer.Layer<SessionHookManagerImplKey, never, never>;
declare const SessionRunStateMachineImplKey_base: Context.ServiceClass<SessionRunStateMachineImplKey, "server/native/SessionRunStateMachineImpl", SessionRunStateMachineImpl>;
export declare class SessionRunStateMachineImplKey extends SessionRunStateMachineImplKey_base {
}
export declare const SessionRunStateMachineImplLayer: Layer.Layer<SessionRunStateMachineImplKey, never, never>;
declare const InterruptionServiceImplKey_base: Context.ServiceClass<InterruptionServiceImplKey, "server/native/InterruptionServiceImpl", InterruptionServiceImpl>;
export declare class InterruptionServiceImplKey extends InterruptionServiceImplKey_base {
}
export declare const InterruptionServiceImplLayer: Layer.Layer<InterruptionServiceImplKey, never, never>;
declare const MessageQueueManagerImplKey_base: Context.ServiceClass<MessageQueueManagerImplKey, "server/native/MessageQueueManagerImpl", MessageQueueManagerImpl>;
export declare class MessageQueueManagerImplKey extends MessageQueueManagerImplKey_base {
}
export declare const MessageQueueManagerImplLayer: Layer.Layer<MessageQueueManagerImplKey, never, never>;
declare const SessionManagerImplKey_base: Context.ServiceClass<SessionManagerImplKey, "server/native/SessionManagerImpl", SessionManagerImpl>;
export declare class SessionManagerImplKey extends SessionManagerImplKey_base {
}
export declare const SessionManagerImplLayer: Layer.Layer<SessionManagerImplKey, never, never>;
export declare const layer: Layer.Layer<SessionManagerImplKey | SessionFactoryImplKey | SessionStoreImplKey | SessionRunStateMachineImplKey | InterruptionServiceImplKey | SessionHookManagerImplKey | SessionHistoryCleanServiceImplKey | IdleQueueDrainServiceImplKey | MessageQueueManagerImplKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof SessionHistoryCleanServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SessionHistoryCleanServiceImplKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof IdleQueueDrainServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SessionFactoryImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SessionStoreImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SessionHookManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SessionRunStateMachineImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof InterruptionServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof MessageQueueManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SessionManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SessionManagerImplKey;
    mode: "add";
})[];
export declare const warmup: Effect.Effect<void, never, SessionManagerImplKey | SessionFactoryImplKey | SessionStoreImplKey | SessionRunStateMachineImplKey | InterruptionServiceImplKey | SessionHookManagerImplKey | SessionHistoryCleanServiceImplKey | IdleQueueDrainServiceImplKey | MessageQueueManagerImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
