import { ProductManager, type RemoteRuntimeSecurity } from '@genie/product';
import { RuntimeSecurityPolicyProvider } from './runtime-security-protocol';
export declare class RuntimeSecurityPolicyProviderImpl implements RuntimeSecurityPolicyProvider {
    protected readonly productManager: ProductManager;
    getPolicy(): Promise<RemoteRuntimeSecurity | undefined>;
}
