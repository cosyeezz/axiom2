import type { McpToolActionProjection, McpToolIdentity } from './protocol';
export declare function projectMcpToolAction(input: {
    identity: McpToolIdentity;
    toolInput: unknown;
}): McpToolActionProjection;
