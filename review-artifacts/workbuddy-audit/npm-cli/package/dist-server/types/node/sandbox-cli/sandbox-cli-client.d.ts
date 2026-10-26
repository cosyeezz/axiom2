import { isSandboxCLIConnectTimeoutError, SandboxCliClientImpl } from '@genie/sandbox-cli/sandbox-cli-client';
import { type SandboxCLIClient as ISandboxCLIClient } from './sandbox-cli-protocol';
export { isSandboxCLIConnectTimeoutError };
/** CellJS wrapper around the shared sandbox-cli NDJSON transport. */
export declare class SandboxCLIClientImpl extends SandboxCliClientImpl implements ISandboxCLIClient {
    private readonly injectedLogger;
    init(): void;
}
