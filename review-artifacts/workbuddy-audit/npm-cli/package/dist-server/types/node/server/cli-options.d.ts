import type { CliProvider } from '../cli/cli-protocol';
import { type McpCliConfigInitializer, type McpConfigManager, type McpManager } from '../mcp/mcp-protocol';
/** Library execution receives options from start/query, never from its host's argv. */
export declare function createServerCliProvider(): CliProvider;
/** Session MCP comes from query options and loaded plugins, never the host's argv or ambient CLI files. */
export declare function createServerMcpInitializer(configs: Pick<McpConfigManager, 'set' | 'setStrictDynamic'>, manager: Pick<McpManager, 'setNonInteractiveMode'>): McpCliConfigInitializer;
