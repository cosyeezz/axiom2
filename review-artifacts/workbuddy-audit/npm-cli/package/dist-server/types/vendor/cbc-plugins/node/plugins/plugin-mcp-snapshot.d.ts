import { type ActivePluginRuntimeEntry } from './plugin-protocol';
declare const PLUGIN_MCP_SNAPSHOT_VERSION: 1;
export interface PluginMcpSnapshotStdioTransport {
    readonly args: readonly string[];
    readonly command: string;
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly type: 'stdio';
}
export interface PluginMcpSnapshotRemoteTransport {
    readonly headers: Readonly<Record<string, string>>;
    readonly type: 'http' | 'sse';
    readonly url: string;
}
export type PluginMcpSnapshotTransport = PluginMcpSnapshotRemoteTransport | PluginMcpSnapshotStdioTransport;
export interface PluginMcpSnapshotServer {
    /** Process-private, opaque identity for this exact resolved server config. */
    readonly identity: string;
    readonly logicalName: string;
    readonly marketplaceName: string;
    readonly pluginId: string;
    readonly pluginName: string;
    readonly pluginRoot: string;
    readonly serverName: string;
    readonly transport: PluginMcpSnapshotTransport;
}
export interface PluginMcpSnapshotError {
    readonly code: 'invalid_config' | 'unsupported_transport';
    readonly message: string;
    readonly pluginId: string;
    readonly serverName: string;
}
export interface ActivePluginMcpSnapshot {
    /**
     * Process-private HMAC of the resolved snapshot. It is stable for equal
     * pinned state and changes when any projected Plugin MCP config changes.
     */
    readonly generation: string;
    readonly errors: readonly PluginMcpSnapshotError[];
    readonly servers: readonly PluginMcpSnapshotServer[];
    readonly version: typeof PLUGIN_MCP_SNAPSHOT_VERSION;
}
export interface CreateActivePluginMcpSnapshotOptions {
    /** Test seam; production always uses the per-process random key. */
    readonly identityKey?: Uint8Array;
    /** Host-authority PATH used to resolve bare stdio executable names. */
    readonly pathEnvironment?: string;
    /** Explicit ambient input for hosts whose executor starts from an empty environment. */
    readonly ambientEnvironment?: Readonly<NodeJS.ProcessEnv>;
    readonly platform?: NodeJS.Platform;
}
/**
 * Projects the exact Plugin MCP subset of PluginManager's current active
 * snapshot. This function never reads desired install/config state and never
 * activates a plugin.
 *
 * Credential values are deliberately present only inside `transport`, because
 * the authenticated Harness Host client must transfer them to its private
 * integration child. `generation` and `identity` are keyed HMACs, never plain
 * hashes or credential-bearing strings.
 */
export declare function createActivePluginMcpSnapshot(activePlugins: readonly ActivePluginRuntimeEntry[], options?: CreateActivePluginMcpSnapshotOptions): Promise<ActivePluginMcpSnapshot>;
export {};
//# sourceMappingURL=plugin-mcp-snapshot.d.ts.map