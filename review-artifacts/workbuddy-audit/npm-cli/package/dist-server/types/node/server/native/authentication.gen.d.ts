import { Context, Effect, Layer } from 'effect';
import { AgentAuthenticationStartupGate } from '../../authentication/authentication-startup-gate';
declare const AgentAuthenticationStartupGateKey_base: Context.ServiceClass<AgentAuthenticationStartupGateKey, "server/native/AgentAuthenticationStartupGate", AgentAuthenticationStartupGate>;
export declare class AgentAuthenticationStartupGateKey extends AgentAuthenticationStartupGateKey_base {
}
export declare const AgentAuthenticationStartupGateLayer: Layer.Layer<AgentAuthenticationStartupGateKey, never, never>;
export declare const layer: Layer.Layer<AgentAuthenticationStartupGateKey, never, never>;
export declare const bridge: {
    token: unknown;
    program: typeof AgentAuthenticationStartupGateKey;
    mode: "rebind";
}[];
export declare const warmup: Effect.Effect<void, never, AgentAuthenticationStartupGateKey>;
export declare const deps: ReadonlyArray<string>;
export {};
