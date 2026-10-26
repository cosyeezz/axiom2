/**
 * MCP SDK runtime 值 lazy 收敛出口（standby heap 优化 #107267 followup）。
 *
 * ## 背景
 *
 * `mcp-protocol.ts` 之前直接 `import { Client, SSEClientTransport, ... } from '@modelcontextprotocol/sdk/...'`
 * + `export { ... }` re-export，rspack 静态分析把整个 MCP SDK（~330 KB 主 chunk 源码）
 * 拉进主 chunk。standby 期无 MCP connect，是 100% 冷代码。
 *
 * 本文件把所有 MCP SDK 的 runtime 值 + `@openai/agents` 里 MCPServer 一族 lazy 化：
 *   1. 顶部只留 `import type { ... }`（TS elide，rspack 静态分析不 pull SDK）。
 *   2. `export let X: typeof XCtor` lazy binding + `preloadMcpSdkValues()` 一次装载。
 *   3. `mcp-protocol.ts` 继续 `export * from './mcp-sdk-values'` 保留下游 caller
 *      `import { Client } from '.../mcp-protocol'` 的 API。
 *
 * ## 契约
 *
 * caller 使用值符号前**必须**先 `await preloadMcpSdkValues()`。已 preload 之后，
 * 深层同步 method 里 `new Client(...)` / `new SSEClientTransport(...)` 直接工作。
 *
 * MCP 的第一个真实 caller 是 `mcp-transport-manager.createTransport` 与
 * `mcp-server-override.connect`，都在 activate 之后 MCP config resolve 完成时才走。
 * 在 `McpReadyService.doInit`（activate coordinator 触发点）里 preload 一次即可。
 */
import type { auth as authFn, discoverAuthorizationServerMetadata as discoverAuthorizationServerMetadataFn, discoverOAuthProtectedResourceMetadata as discoverOAuthProtectedResourceMetadataFn, discoverOAuthServerInfo as discoverOAuthServerInfoFn, exchangeAuthorization as exchangeAuthorizationFn, extractResourceMetadataUrl as extractResourceMetadataUrlFn, OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { Client as ClientTypeCtor } from '@modelcontextprotocol/sdk/client/index.js';
import type { SSEClientTransport as SSEClientTransportTypeCtor, SSEClientTransportOptions } from '@modelcontextprotocol/sdk/client/sse.js';
import type { StdioClientTransport as StdioClientTransportTypeCtor, StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { StreamableHTTPClientTransport as StreamableHTTPClientTransportTypeCtor, StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AuthorizationServerMetadata, OAuthClientInformation, OAuthClientInformationFull, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { ReadBuffer as ReadBufferTypeCtor, serializeMessage as serializeMessageFn } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { CallToolResult, CallToolResultSchema as CallToolResultSchemaType, GetPromptResult, GetPromptResultSchema as GetPromptResultSchemaType, ListPromptsResultSchema as ListPromptsResultSchemaType, ListResourcesResultSchema as ListResourcesResultSchemaType, ListResourceTemplatesResultSchema as ListResourceTemplatesResultSchemaType, ListToolsResultSchema as ListToolsResultSchemaType, Prompt, ReadResourceResult, ReadResourceResultSchema as ReadResourceResultSchemaType, Resource, ResourceTemplate, SamplingMessageSchema as SamplingMessageSchemaType, ToolListChangedNotificationSchema as ToolListChangedNotificationSchemaType } from '@modelcontextprotocol/sdk/types.js';
import type { MCPServerSSE as MCPServerSSETypeCtor, MCPServerStdio as MCPServerStdioTypeCtor, MCPServerStreamableHttp as MCPServerStreamableHttpTypeCtor, MCPToolFilterCallable } from '@openai/agents';
export type { OAuthClientProvider, OAuthDiscoveryState, AuthorizationServerMetadata, OAuthClientInformation, OAuthClientInformationFull, OAuthClientMetadata, OAuthTokens, SSEClientTransportOptions, StdioServerParameters, StreamableHTTPClientTransportOptions, CallToolResult, GetPromptResult, Prompt, ReadResourceResult, Resource, ResourceTemplate, MCPToolFilterCallable, };
export type Client = InstanceType<typeof ClientTypeCtor>;
export type SSEClientTransport = InstanceType<typeof SSEClientTransportTypeCtor>;
export type StdioClientTransport = InstanceType<typeof StdioClientTransportTypeCtor>;
export type StreamableHTTPClientTransport = InstanceType<typeof StreamableHTTPClientTransportTypeCtor>;
export type MCPServerSSE = InstanceType<typeof MCPServerSSETypeCtor>;
export type MCPServerStdio = InstanceType<typeof MCPServerStdioTypeCtor>;
export type MCPServerStreamableHttp = InstanceType<typeof MCPServerStreamableHttpTypeCtor>;
export declare let Client: typeof ClientTypeCtor;
export declare let SSEClientTransport: typeof SSEClientTransportTypeCtor;
export declare let StdioClientTransport: typeof StdioClientTransportTypeCtor;
export declare let StreamableHTTPClientTransport: typeof StreamableHTTPClientTransportTypeCtor;
export declare let MCPServerSSE: typeof MCPServerSSETypeCtor;
export declare let MCPServerStdio: typeof MCPServerStdioTypeCtor;
export declare let MCPServerStreamableHttp: typeof MCPServerStreamableHttpTypeCtor;
export declare let ReadBuffer: typeof ReadBufferTypeCtor;
export declare let serializeMessage: typeof serializeMessageFn;
export declare let auth: typeof authFn;
export declare let discoverAuthorizationServerMetadata: typeof discoverAuthorizationServerMetadataFn;
export declare let discoverOAuthProtectedResourceMetadata: typeof discoverOAuthProtectedResourceMetadataFn;
export declare let discoverOAuthServerInfo: typeof discoverOAuthServerInfoFn;
export declare let exchangeAuthorization: typeof exchangeAuthorizationFn;
export declare let extractResourceMetadataUrl: typeof extractResourceMetadataUrlFn;
export declare let CallToolResultSchema: typeof CallToolResultSchemaType;
export declare let GetPromptResultSchema: typeof GetPromptResultSchemaType;
export declare let ListPromptsResultSchema: typeof ListPromptsResultSchemaType;
export declare let ListResourcesResultSchema: typeof ListResourcesResultSchemaType;
export declare let ListResourceTemplatesResultSchema: typeof ListResourceTemplatesResultSchemaType;
export declare let ListToolsResultSchema: typeof ListToolsResultSchemaType;
export declare let ReadResourceResultSchema: typeof ReadResourceResultSchemaType;
export declare let SamplingMessageSchema: typeof SamplingMessageSchemaType;
export declare let ToolListChangedNotificationSchema: typeof ToolListChangedNotificationSchemaType;
export declare function preloadMcpSdkValues(): Promise<void>;
