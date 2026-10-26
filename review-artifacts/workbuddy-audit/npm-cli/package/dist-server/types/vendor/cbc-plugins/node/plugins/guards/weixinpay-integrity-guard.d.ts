/**
 * Weixinpay plugin directory integrity guard.
 *
 * On Windows, verifies the weixinpay plugin directory against its
 * manifest.qmsig using QmProtectorLib.dll. Bun executables use Bun's native
 * FFI; the Node/npm distribution keeps Koffi as its Node-API adapter.
 * On other platforms or when the runtime FFI is unavailable, passthrough.
 */
import { PluginInfo, PluginLoadGuard } from '../plugin-protocol';
/**
 * Windows x64 layout of QM_SIGNER_VERIFY_OPTIONS / RESULT.
 *
 * The Bun branch is intentionally local to Agent CLI: Agent Harness embeds
 * the same CodeBuddy bundle but neither knows about this plugin nor ships a
 * generic native FFI sidecar.
 */
export declare function createBunFfiWeixinpayBinding(ffi: BunFfiModule, dllPath: string): WeixinpayBinding;
export declare class WeixinpayIntegrityGuard implements PluginLoadGuard {
    private readonly logger;
    private bindingCache;
    canLoad(plugin: PluginInfo): Promise<boolean>;
    private getBinding;
    private pathExists;
}
interface WeixinpayBinding {
    verify(rootDir: string, manifestPath: string): {
        hr: number;
        filesOk: number;
        filesBad: number;
        filesMissing: number;
        extraEntries: number;
    };
}
export interface BunFfiModule {
    readonly FFIType: {
        readonly i32: number;
        readonly ptr: number;
    };
    dlopen(path: string, symbols: Record<string, {
        readonly args: readonly number[];
        readonly returns: number;
    }>): {
        readonly close?: () => void;
        readonly symbols: Record<string, (optionsPointer: number, resultPointer: number) => number>;
    };
    ptr(value: Uint8Array): number;
}
export {};
//# sourceMappingURL=weixinpay-integrity-guard.d.ts.map