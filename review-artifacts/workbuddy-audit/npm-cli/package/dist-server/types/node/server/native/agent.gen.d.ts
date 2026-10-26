import { Context, Effect, Layer } from 'effect';
import { AgentCompletionWaiterImpl } from '../../agent/agent-completion-waiter';
import { AgentManagerImpl } from '../../agent/agent-manager';
import { AgentServiceImpl, DefaultAgentFactory, RunnerFactoryImpl, RunnerProviderImpl, ToolCallLoopDetectorImpl } from '../../../vendor/cbc-core/node/index.js';
declare const AgentCompletionWaiterImplKey_base: Context.ServiceClass<AgentCompletionWaiterImplKey, "server/native/AgentCompletionWaiterImpl", AgentCompletionWaiterImpl>;
export declare class AgentCompletionWaiterImplKey extends AgentCompletionWaiterImplKey_base {
}
export declare const AgentCompletionWaiterImplLayer: Layer.Layer<AgentCompletionWaiterImplKey, never, never>;
declare const DefaultAgentFactoryKey_base: Context.ServiceClass<DefaultAgentFactoryKey, "server/native/DefaultAgentFactory", DefaultAgentFactory>;
export declare class DefaultAgentFactoryKey extends DefaultAgentFactoryKey_base {
}
export declare const DefaultAgentFactoryLayer: Layer.Layer<DefaultAgentFactoryKey, never, never>;
declare const AgentManagerImplKey_base: Context.ServiceClass<AgentManagerImplKey, "server/native/AgentManagerImpl", AgentManagerImpl>;
export declare class AgentManagerImplKey extends AgentManagerImplKey_base {
}
export declare const AgentManagerImplLayer: Layer.Layer<AgentManagerImplKey, never, never>;
declare const ToolCallLoopDetectorImplKey_base: Context.ServiceClass<ToolCallLoopDetectorImplKey, "server/native/ToolCallLoopDetectorImpl", ToolCallLoopDetectorImpl>;
export declare class ToolCallLoopDetectorImplKey extends ToolCallLoopDetectorImplKey_base {
}
export declare const ToolCallLoopDetectorImplLayer: Layer.Layer<ToolCallLoopDetectorImplKey, never, never>;
declare const RunnerFactoryImplKey_base: Context.ServiceClass<RunnerFactoryImplKey, "server/native/RunnerFactoryImpl", RunnerFactoryImpl>;
export declare class RunnerFactoryImplKey extends RunnerFactoryImplKey_base {
}
export declare const RunnerFactoryImplLayer: Layer.Layer<RunnerFactoryImplKey, never, never>;
declare const RunnerProviderImplKey_base: Context.ServiceClass<RunnerProviderImplKey, "server/native/RunnerProviderImpl", RunnerProviderImpl>;
export declare class RunnerProviderImplKey extends RunnerProviderImplKey_base {
}
export declare const RunnerProviderImplLayer: Layer.Layer<RunnerProviderImplKey, never, never>;
declare const AgentServiceImplKey_base: Context.ServiceClass<AgentServiceImplKey, "server/native/AgentServiceImpl", AgentServiceImpl>;
export declare class AgentServiceImplKey extends AgentServiceImplKey_base {
}
export declare const AgentServiceImplLayer: Layer.Layer<AgentServiceImplKey, never, never>;
export declare const layer: Layer.Layer<AgentCompletionWaiterImplKey | DefaultAgentFactoryKey | AgentManagerImplKey | ToolCallLoopDetectorImplKey | RunnerFactoryImplKey | RunnerProviderImplKey | AgentServiceImplKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof AgentCompletionWaiterImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof DefaultAgentFactoryKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof AgentManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof ToolCallLoopDetectorImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof RunnerFactoryImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof RunnerProviderImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof AgentServiceImplKey;
    mode: "rebind";
})[];
export declare const warmup: Effect.Effect<void, never, AgentCompletionWaiterImplKey | DefaultAgentFactoryKey | AgentManagerImplKey | ToolCallLoopDetectorImplKey | RunnerFactoryImplKey | RunnerProviderImplKey | AgentServiceImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
