/**
 * Permission Bridge Client — Teammate 子进程侧
 *
 * 独立进程 teammate 使用此客户端将工具审批请求发送到 leader 的 HTTP API，
 * 等待 leader 侧用户审批后返回结果。
 *
 * 使用 HTTP long-poll 模式：POST 请求会阻塞直到 leader 返回审批结果。
 */
import type { PermissionDecision } from './permission-bridge-protocol';
export declare class PermissionBridgeClient {
    private leaderEndpoint;
    private teammateName;
    private teamName;
    /** leader 为本机 daemon/`--serve` 时默认启用密码鉴权，审批回程需要带本机凭据（仅回环）。 */
    private authHeaders?;
    constructor(leaderEndpoint: string, teammateName: string, teamName: string);
    /**
     * 请求权限审批。阻塞直到 leader 返回结果或超时。
     *
     * @param toolName 工具名称
     * @param toolArguments 工具参数 JSON 字符串
     * @param toolCallId 工具调用 ID
     * @param signal 工具调用的中止信号（`CanUseToolOptions.signal`）。带上它，工具被中断 / 整轮 abort
     *   时能立刻收口成 deny 并断开在途长轮询，而不是把 teammate 挂在 HTTP 上等到 6 分钟超时。
     * @returns 审批决策
     */
    requestPermission(toolName: string, toolArguments: string, toolCallId: string, signal?: AbortSignal): Promise<{
        decision: PermissionDecision;
        reason?: string;
    }>;
    /**
     * 检查 leader endpoint 是否可达
     */
    isAvailable(): Promise<boolean>;
    private getAuthHeaders;
    private post;
}
