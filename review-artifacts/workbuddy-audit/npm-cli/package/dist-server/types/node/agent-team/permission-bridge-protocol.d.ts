/**
 * Permission Bridge 协议定义
 *
 * 独立进程 teammate 的工具审批请求通过 HTTP API 路由回 leader 进程，
 * 由 leader 的 InterruptionService 展示给用户审批。
 */
export declare const PermissionBridgeService: unique symbol;
export interface PermissionBridgeRequest {
    /** 唯一请求 ID */
    requestId: string;
    /** Teammate 名称 */
    teammateName: string;
    /** Team 名称 */
    teamName: string;
    /** 工具名称 */
    toolName: string;
    /** 工具调用参数（序列化的 JSON 字符串） */
    toolArguments: string;
    /** 工具调用 ID（用于匹配 InterruptionService 中的 approval item） */
    toolCallId: string;
    /** 请求时间戳 */
    timestamp: string;
}
export type PermissionDecision = 'allow' | 'allowAll' | 'deny' | 'rejectAndExitPlan';
export interface PermissionBridgeResponse {
    /** 对应的请求 ID */
    requestId: string;
    /** 审批决策 */
    decision: PermissionDecision;
    /** 拒绝原因或用户反馈 */
    reason?: string;
}
/**
 * Leader 侧 Permission Bridge 服务。
 * 接收 teammate 的权限请求，注入 InterruptionService，等待用户决策后返回。
 */
export interface IPermissionBridgeService {
    /**
     * 处理来自 teammate 的权限请求。
     * 阻塞直到用户通过 InterruptionService 做出决策。
     *
     * @param request 权限请求
     * @param signal 用于取消等待的 AbortSignal
     * @returns 审批结果
     */
    handleRequest(request: PermissionBridgeRequest, signal?: AbortSignal): Promise<PermissionBridgeResponse>;
}
