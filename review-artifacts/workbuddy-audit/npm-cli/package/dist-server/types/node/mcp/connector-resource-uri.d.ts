/**
 * Connector resource URI wrapping helpers (mirror of the desktop
 * `connector-proxy-server` implementation).
 *
 * Background: WorkBuddy Desktop's `connector-proxy` aggregates several backend
 * MCP servers (hr_data_service, qq-mail, …) into a single virtual MCP server
 * exposed to cbc. Tools already preserve backend identity through their name
 * prefix (`<short>_<toolName>`), but resources used to be passed through with
 * their raw `uri`, which made every resource appear to come from
 * `connector-proxy` itself — the model could never filter resources by
 * backend name (`server: "hr_data_service"`).
 *
 * The desktop side now wraps each resource URI as
 *   `mcp+connector://<encodedConfigId>/<encodedOriginalUri>`
 * and decodes it on `resources/read`. This file gives the cbc side the same
 * parser so that the resource catalog and the `ReadMcpResource` tool can
 * recover the backend's short name and route correctly.
 *
 * NOTE: this file is intentionally duplicated from
 * `apps/workbuddy-desktop/src/main/connectors/connector-proxy-server.ts`
 * because cbc and the desktop ship as separate packages and don't share an
 * internal module. Keep the two definitions in sync.
 */
export declare const CONNECTOR_RESOURCE_URI_SCHEME = "mcp+connector";
export declare const CONNECTOR_RESOURCE_URI_PREFIX = "mcp+connector://";
/**
 * The virtual server name used by `connector-proxy` when it registers itself
 * with cbc's MCP manager. Resources whose URI is a wrapper are physically
 * read through this server, even though the catalog reports them under the
 * backend's short name.
 */
export declare const CONNECTOR_PROXY_SERVER_NAME = "connector-proxy";
export interface ParsedConnectorResourceUri {
    /** Full configId, e.g. `custom-mcp:hr_data_service` or `connector:qq-mail`. */
    configId: string;
    /** The original URI as the backend MCP server emits it. */
    originalUri: string;
    /** Short backend name suitable as a `serverName` (`hr_data_service`, `qq-mail`). */
    backendShortName: string;
}
/**
 * Strip the `connector:` / `custom-mcp:` scope prefix from a configId.
 * Mirrors `ConnectorMcpProxy.extractServerShortName`.
 */
export declare function extractBackendShortName(configId: string): string;
/**
 * Parse a wrapper URI back into its components. Returns `undefined` when the
 * input is not a wrapper (regular MCP resources from non-connector-proxy
 * servers should be left untouched).
 */
export declare function parseConnectorResourceUri(wrapped: string): ParsedConnectorResourceUri | undefined;
