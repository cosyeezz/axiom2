import { Context, Effect, Layer } from 'effect';
import { AgentScopedMcpManagerImpl } from '../../mcp/agent-scoped-mcp-manager';
import { McpCliConfigInitializerImpl } from '../../mcp/mcp-cli-config-initializer';
import { McpConfigDiagnosticsManagerImpl } from '../../mcp/mcp-config-diagnostics-manager';
import { McpConfigEnvExpandServiceImpl } from '../../mcp/mcp-config-env-expand-service';
import { McpConfigManagerImpl } from '../../mcp/mcp-config-manager';
import { McpConfigStoreImpl } from '../../mcp/mcp-config-store';
import { McpConnectionManagerImpl } from '../../mcp/mcp-connection-manager';
import { McpFirstRunStatusServiceImpl } from '../../mcp/mcp-first-run-status-service';
import { McpLogServiceImpl } from '../../mcp/mcp-log-service';
import { McpManagerImpl } from '../../mcp/mcp-manager';
import { McpOAuthManagerImpl } from '../../mcp/mcp-oauth-manager';
import { McpOauthStoreImpl } from '../../mcp/mcp-oauth-store';
import { McpPermissionsManagerImpl } from '../../mcp/mcp-permissions-manager';
import { McpPluginRegistry } from '../../mcp/mcp-plugin-registry';
import { McpReadyServiceImpl } from '../../mcp/mcp-ready-service';
import { McpResourceCatalogServiceImpl } from '../../mcp/mcp-resource-catalog';
import { McpServerManagerImpl } from '../../mcp/mcp-server-manager';
import { McpServerModelManagerImpl } from '../../mcp/mcp-server-model-manager';
import { McpSubagentToolManagerImpl } from '../../mcp/mcp-subagent-tool-manager';
import { McpToggleManagerImpl } from '../../mcp/mcp-toggle-manager';
import { McpTransportManagerImpl } from '../../mcp/mcp-transport-manager';
declare const McpConfigStoreImplKey_base: Context.ServiceClass<McpConfigStoreImplKey, "server/native/McpConfigStoreImpl", McpConfigStoreImpl>;
export declare class McpConfigStoreImplKey extends McpConfigStoreImplKey_base {
}
export declare const McpConfigStoreImplLayer: Layer.Layer<McpConfigStoreImplKey, never, never>;
declare const McpLogServiceImplKey_base: Context.ServiceClass<McpLogServiceImplKey, "server/native/McpLogServiceImpl", McpLogServiceImpl>;
export declare class McpLogServiceImplKey extends McpLogServiceImplKey_base {
}
export declare const McpLogServiceImplLayer: Layer.Layer<McpLogServiceImplKey, never, never>;
declare const McpConfigEnvExpandServiceImplKey_base: Context.ServiceClass<McpConfigEnvExpandServiceImplKey, "server/native/McpConfigEnvExpandServiceImpl", McpConfigEnvExpandServiceImpl>;
export declare class McpConfigEnvExpandServiceImplKey extends McpConfigEnvExpandServiceImplKey_base {
}
export declare const McpConfigEnvExpandServiceImplLayer: Layer.Layer<McpConfigEnvExpandServiceImplKey, never, never>;
declare const McpConfigDiagnosticsManagerImplKey_base: Context.ServiceClass<McpConfigDiagnosticsManagerImplKey, "server/native/McpConfigDiagnosticsManagerImpl", McpConfigDiagnosticsManagerImpl>;
export declare class McpConfigDiagnosticsManagerImplKey extends McpConfigDiagnosticsManagerImplKey_base {
}
export declare const McpConfigDiagnosticsManagerImplLayer: Layer.Layer<McpConfigDiagnosticsManagerImplKey, never, never>;
declare const McpConfigManagerImplKey_base: Context.ServiceClass<McpConfigManagerImplKey, "server/native/McpConfigManagerImpl", McpConfigManagerImpl>;
export declare class McpConfigManagerImplKey extends McpConfigManagerImplKey_base {
}
export declare const McpConfigManagerImplLayer: Layer.Layer<McpConfigManagerImplKey, never, never>;
declare const McpServerModelManagerImplKey_base: Context.ServiceClass<McpServerModelManagerImplKey, "server/native/McpServerModelManagerImpl", McpServerModelManagerImpl>;
export declare class McpServerModelManagerImplKey extends McpServerModelManagerImplKey_base {
}
export declare const McpServerModelManagerImplLayer: Layer.Layer<McpServerModelManagerImplKey, never, never>;
declare const McpOauthStoreImplKey_base: Context.ServiceClass<McpOauthStoreImplKey, "server/native/McpOauthStoreImpl", McpOauthStoreImpl>;
export declare class McpOauthStoreImplKey extends McpOauthStoreImplKey_base {
}
export declare const McpOauthStoreImplLayer: Layer.Layer<McpOauthStoreImplKey, never, never>;
declare const McpOAuthManagerImplKey_base: Context.ServiceClass<McpOAuthManagerImplKey, "server/native/McpOAuthManagerImpl", McpOAuthManagerImpl>;
export declare class McpOAuthManagerImplKey extends McpOAuthManagerImplKey_base {
}
export declare const McpOAuthManagerImplLayer: Layer.Layer<McpOAuthManagerImplKey, never, never>;
declare const McpServerManagerImplKey_base: Context.ServiceClass<McpServerManagerImplKey, "server/native/McpServerManagerImpl", McpServerManagerImpl>;
export declare class McpServerManagerImplKey extends McpServerManagerImplKey_base {
}
export declare const McpServerManagerImplLayer: Layer.Layer<McpServerManagerImplKey, never, never>;
declare const McpPermissionsManagerImplKey_base: Context.ServiceClass<McpPermissionsManagerImplKey, "server/native/McpPermissionsManagerImpl", McpPermissionsManagerImpl>;
export declare class McpPermissionsManagerImplKey extends McpPermissionsManagerImplKey_base {
}
export declare const McpPermissionsManagerImplLayer: Layer.Layer<McpPermissionsManagerImplKey, never, never>;
declare const McpConnectionManagerImplKey_base: Context.ServiceClass<McpConnectionManagerImplKey, "server/native/McpConnectionManagerImpl", McpConnectionManagerImpl>;
export declare class McpConnectionManagerImplKey extends McpConnectionManagerImplKey_base {
}
export declare const McpConnectionManagerImplLayer: Layer.Layer<McpConnectionManagerImplKey, never, never>;
declare const McpToggleManagerImplKey_base: Context.ServiceClass<McpToggleManagerImplKey, "server/native/McpToggleManagerImpl", McpToggleManagerImpl>;
export declare class McpToggleManagerImplKey extends McpToggleManagerImplKey_base {
}
export declare const McpToggleManagerImplLayer: Layer.Layer<McpToggleManagerImplKey, never, never>;
declare const McpReadyServiceImplKey_base: Context.ServiceClass<McpReadyServiceImplKey, "server/native/McpReadyServiceImpl", McpReadyServiceImpl>;
export declare class McpReadyServiceImplKey extends McpReadyServiceImplKey_base {
}
export declare const McpReadyServiceImplLayer: Layer.Layer<McpReadyServiceImplKey, never, never>;
declare const McpManagerImplKey_base: Context.ServiceClass<McpManagerImplKey, "server/native/McpManagerImpl", McpManagerImpl>;
export declare class McpManagerImplKey extends McpManagerImplKey_base {
}
export declare const McpManagerImplLayer: Layer.Layer<McpManagerImplKey, never, never>;
declare const McpPluginRegistryKey_base: Context.ServiceClass<McpPluginRegistryKey, "server/native/McpPluginRegistry", McpPluginRegistry>;
export declare class McpPluginRegistryKey extends McpPluginRegistryKey_base {
}
export declare const McpPluginRegistryLayer: Layer.Layer<McpPluginRegistryKey, never, never>;
declare const McpTransportManagerImplKey_base: Context.ServiceClass<McpTransportManagerImplKey, "server/native/McpTransportManagerImpl", McpTransportManagerImpl>;
export declare class McpTransportManagerImplKey extends McpTransportManagerImplKey_base {
}
export declare const McpTransportManagerImplLayer: Layer.Layer<McpTransportManagerImplKey, never, never>;
declare const AgentScopedMcpManagerImplKey_base: Context.ServiceClass<AgentScopedMcpManagerImplKey, "server/native/AgentScopedMcpManagerImpl", AgentScopedMcpManagerImpl>;
export declare class AgentScopedMcpManagerImplKey extends AgentScopedMcpManagerImplKey_base {
}
export declare const AgentScopedMcpManagerImplLayer: Layer.Layer<AgentScopedMcpManagerImplKey, never, never>;
declare const McpCliConfigInitializerImplKey_base: Context.ServiceClass<McpCliConfigInitializerImplKey, "server/native/McpCliConfigInitializerImpl", McpCliConfigInitializerImpl>;
export declare class McpCliConfigInitializerImplKey extends McpCliConfigInitializerImplKey_base {
}
export declare const McpCliConfigInitializerImplLayer: Layer.Layer<McpCliConfigInitializerImplKey, never, never>;
declare const McpFirstRunStatusServiceImplKey_base: Context.ServiceClass<McpFirstRunStatusServiceImplKey, "server/native/McpFirstRunStatusServiceImpl", McpFirstRunStatusServiceImpl>;
export declare class McpFirstRunStatusServiceImplKey extends McpFirstRunStatusServiceImplKey_base {
}
export declare const McpFirstRunStatusServiceImplLayer: Layer.Layer<McpFirstRunStatusServiceImplKey, never, never>;
declare const McpResourceCatalogServiceImplKey_base: Context.ServiceClass<McpResourceCatalogServiceImplKey, "server/native/McpResourceCatalogServiceImpl", McpResourceCatalogServiceImpl>;
export declare class McpResourceCatalogServiceImplKey extends McpResourceCatalogServiceImplKey_base {
}
export declare const McpResourceCatalogServiceImplLayer: Layer.Layer<McpResourceCatalogServiceImplKey, never, never>;
declare const McpSubagentToolManagerImplKey_base: Context.ServiceClass<McpSubagentToolManagerImplKey, "server/native/McpSubagentToolManagerImpl", McpSubagentToolManagerImpl>;
export declare class McpSubagentToolManagerImplKey extends McpSubagentToolManagerImplKey_base {
}
export declare const McpSubagentToolManagerImplLayer: Layer.Layer<McpSubagentToolManagerImplKey, never, never>;
export declare const layer: Layer.Layer<McpConfigStoreImplKey | McpLogServiceImplKey | McpConfigEnvExpandServiceImplKey | McpConfigDiagnosticsManagerImplKey | McpConfigManagerImplKey | McpServerModelManagerImplKey | McpOauthStoreImplKey | McpOAuthManagerImplKey | McpServerManagerImplKey | McpPermissionsManagerImplKey | McpConnectionManagerImplKey | McpToggleManagerImplKey | McpReadyServiceImplKey | McpManagerImplKey | McpPluginRegistryKey | McpTransportManagerImplKey | AgentScopedMcpManagerImplKey | McpCliConfigInitializerImplKey | McpFirstRunStatusServiceImplKey | McpResourceCatalogServiceImplKey | McpSubagentToolManagerImplKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof McpConfigStoreImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof McpLogServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof McpConfigEnvExpandServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof McpConfigDiagnosticsManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof McpConfigManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof McpServerModelManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof McpOauthStoreImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof McpOAuthManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof McpServerManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof McpPermissionsManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof McpConnectionManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof McpToggleManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof McpReadyServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof McpManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof McpPluginRegistryKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof McpTransportManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof AgentScopedMcpManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof McpCliConfigInitializerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof McpFirstRunStatusServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof McpResourceCatalogServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof McpSubagentToolManagerImplKey;
    mode: "rebind";
})[];
export declare const warmup: Effect.Effect<void, never, McpConfigStoreImplKey | McpLogServiceImplKey | McpConfigEnvExpandServiceImplKey | McpConfigDiagnosticsManagerImplKey | McpConfigManagerImplKey | McpServerModelManagerImplKey | McpOauthStoreImplKey | McpOAuthManagerImplKey | McpServerManagerImplKey | McpPermissionsManagerImplKey | McpConnectionManagerImplKey | McpToggleManagerImplKey | McpReadyServiceImplKey | McpManagerImplKey | McpPluginRegistryKey | McpTransportManagerImplKey | AgentScopedMcpManagerImplKey | McpCliConfigInitializerImplKey | McpFirstRunStatusServiceImplKey | McpResourceCatalogServiceImplKey | McpSubagentToolManagerImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
