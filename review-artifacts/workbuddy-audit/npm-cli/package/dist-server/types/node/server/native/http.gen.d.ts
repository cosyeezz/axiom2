import { Context, Effect, Layer } from 'effect';
import { CertificateManager } from '../../http/certificate-manager';
import { CustomHeadersProvider } from '../../http/custom-headers-provider';
declare const CertificateManagerKey_base: Context.ServiceClass<CertificateManagerKey, "server/native/CertificateManager", CertificateManager>;
export declare class CertificateManagerKey extends CertificateManagerKey_base {
}
export declare const CertificateManagerLayer: Layer.Layer<CertificateManagerKey, never, never>;
declare const CustomHeadersProviderKey_base: Context.ServiceClass<CustomHeadersProviderKey, "server/native/CustomHeadersProvider", CustomHeadersProvider>;
export declare class CustomHeadersProviderKey extends CustomHeadersProviderKey_base {
}
export declare const CustomHeadersProviderLayer: Layer.Layer<CustomHeadersProviderKey, never, never>;
export declare const layer: Layer.Layer<CertificateManagerKey | CustomHeadersProviderKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof CertificateManagerKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof CustomHeadersProviderKey;
    mode: "rebind";
})[];
export declare const warmup: Effect.Effect<void, never, CertificateManagerKey | CustomHeadersProviderKey>;
export declare const deps: ReadonlyArray<string>;
export {};
