import { AuthenticationManager } from '@genie/authentication';
import { ClientInfoProvider } from '@genie/product';
import { Workspace } from '@genie/runtime';
import { ResourceAttributes, ResourcesProvider } from '@genie/telemetry';
export declare class CliResourcesProvider implements ResourcesProvider {
    protected clientInfoProvider: ClientInfoProvider;
    protected readonly authenticationManager: AuthenticationManager;
    protected readonly workspace: Workspace;
    provide(): Promise<ResourceAttributes>;
}
