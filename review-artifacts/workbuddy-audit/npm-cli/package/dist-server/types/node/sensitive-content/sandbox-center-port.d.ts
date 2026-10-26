import { SandboxCenterDetectionPort } from '@genie/sandbox-cli/sandbox-center-port';
import { type SandboxCenterIpcClient as SandboxCenterIpcClientInterface } from './sandbox-center-ipc-client-protocol';
export declare class SandboxCenterPortImpl extends SandboxCenterDetectionPort {
    protected sandboxCenterClient: SandboxCenterIpcClientInterface;
}
