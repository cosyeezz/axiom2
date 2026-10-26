export declare const TOOL_CONTROL_BLOCKED_MARKER = "WORKBUDDY_TOOL_CONTROL_BLOCKED";
export declare const ToolControlPolicy: unique symbol;
export type ToolControlBlockReason = 'tool_disabled' | 'mcp_server_disabled' | 'mcp_tool_disabled' | 'custom_mcp_disabled';
export interface ToolControlAuditContext {
    sessionId?: string;
    requestId?: string;
    toolCallId?: string;
}
export interface ToolControlMcpContext extends ToolControlAuditContext {
    serverId: string;
    toolName: string;
    custom: boolean;
    toolControlId?: string;
    compatibleToolControlIds?: readonly string[];
}
export interface ToolControlPolicy {
    assertToolExecutionAllowed(toolName: string, context?: ToolControlAuditContext): Promise<void>;
    assertMcpToolExecutionAllowed(context: ToolControlMcpContext): Promise<void>;
}
export declare class ToolControlBlockedError extends Error {
    readonly code = "WORKBUDDY_TOOL_CONTROL_BLOCKED";
    readonly retryable = false;
    readonly reason: ToolControlBlockReason;
    readonly toolId: string;
    readonly serverId?: string;
    constructor(toolId: string, toolName: string, reason: ToolControlBlockReason, serverId?: string);
}
export declare function isToolControlBlockedError(error: unknown): error is ToolControlBlockedError;
export declare class ToolControlPolicyImpl implements ToolControlPolicy {
    private readSettings;
    private block;
    assertToolExecutionAllowed(toolName: string, context?: ToolControlAuditContext): Promise<void>;
    assertMcpToolExecutionAllowed(context: ToolControlMcpContext): Promise<void>;
}
