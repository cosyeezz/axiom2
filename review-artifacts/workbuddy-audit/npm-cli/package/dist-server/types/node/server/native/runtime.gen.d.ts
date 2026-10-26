import { Context, Effect, Layer } from 'effect';
import { HostCapabilityProvider } from '../../runtime/host-capability-provider';
declare const HostCapabilityProviderKey_base: Context.ServiceClass<HostCapabilityProviderKey, "server/native/HostCapabilityProvider", HostCapabilityProvider>;
export declare class HostCapabilityProviderKey extends HostCapabilityProviderKey_base {
}
export declare const HostCapabilityProviderLayer: Layer.Layer<HostCapabilityProviderKey, never, never>;
export declare const layer: Layer.Layer<HostCapabilityProviderKey, never, never>;
export declare const bridge: {
    token: unknown;
    program: typeof HostCapabilityProviderKey;
    mode: "rebind";
}[];
export declare const warmup: Effect.Effect<void, never, HostCapabilityProviderKey>;
export declare const deps: ReadonlyArray<string>;
export {};
