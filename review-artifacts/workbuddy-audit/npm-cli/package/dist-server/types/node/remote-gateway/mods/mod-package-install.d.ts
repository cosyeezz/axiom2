import type { PluginPackageAddRequest, PluginPackageAddResult } from '../../cli/plugin-package-add';
export type WebModPackageRequest = Pick<PluginPackageAddRequest, 'package' | 'registry'> & {
    ref?: string;
    sha?: string;
    subdir?: string;
};
export declare function parseWebModPackageRequest(value: unknown): WebModPackageRequest;
/** Web installation is inert; exact-version approval and activation remain separate user commands. */
export declare class WebModPackageInstaller {
    private readonly add;
    private active;
    constructor(add: (request: PluginPackageAddRequest) => Promise<PluginPackageAddResult>);
    install(value: unknown): Promise<{
        installation: PluginPackageAddResult;
    }>;
}
