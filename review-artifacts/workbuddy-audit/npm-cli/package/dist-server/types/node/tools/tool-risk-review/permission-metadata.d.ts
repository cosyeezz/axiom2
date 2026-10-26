export { TOOL_RISK_EXECUTION_APPROVAL_PROVIDER_KEY } from '@genie/agent-client-protocol';
/** 内容审批 ID 同时绑定原始 Tool Call 与内容哈希（sha256 hex），内容变化即失效。 */
export declare function contentApprovalId(toolCallId: string, projectionHash: string): string;
/** 还原内容审批对应的原始 Tool Call ID；非内容审批 ID 原样返回。 */
export declare function contentApprovalToolCallId(approvalId: string): string;
/** ACP 只承载审批卡片需要的展示字段，动作绑定凭据留在 Agent CLI 内部。 */
export declare function projectToolRiskPermissionMetadata(providerData: unknown): Record<string, unknown>;
export declare function hasToolRiskPermissionMetadata(providerData: unknown): boolean;
