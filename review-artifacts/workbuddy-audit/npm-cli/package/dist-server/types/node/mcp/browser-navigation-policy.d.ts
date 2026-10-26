import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { McpConfig } from './mcp-protocol';
/** Checks explicit managed Browser navigation, not browser-generated traffic. */
export declare function checkBrowserNavigationPolicy(config: McpConfig, toolName: string, args: Record<string, unknown> | null, session?: Session, signal?: AbortSignal, toolCallId?: string): Promise<void>;
