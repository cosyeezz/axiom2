import { type ProductManager } from '@genie/product';
import type { Hook } from '../hooks/hook-protocol';
type RuntimeSecurityModule = Pick<typeof import('./register-runtime-security'), 'getRuntimeSecurityHooks'>;
type RuntimeSecurityModuleLoader = () => Promise<RuntimeSecurityModule>;
export declare class RuntimeSecurityHookLoader {
    private readonly productManager;
    private readonly loadModule;
    private hooksPromise;
    constructor(productManager: ProductManager, loadModule?: RuntimeSecurityModuleLoader);
    getHooks(): Promise<Hook[]>;
}
export {};
