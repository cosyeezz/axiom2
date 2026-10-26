import { type ProgressCallback } from '../plugin-protocol';
import { DirectoryMarketplace } from './directory-marketplace';
/** Uses the same staged publication and registry ownership as other remote marketplaces. */
export declare class ProviderMarketplace extends DirectoryMarketplace {
    private prepare;
    install(_progress?: ProgressCallback): Promise<void>;
    update(_progress?: ProgressCallback): Promise<boolean>;
    private publish;
}
//# sourceMappingURL=provider-marketplace.d.ts.map