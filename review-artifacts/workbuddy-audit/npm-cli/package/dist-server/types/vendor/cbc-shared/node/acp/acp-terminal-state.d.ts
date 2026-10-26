import type { AcpTerminalStateItem } from '../agent/custom-input-item-types';
export declare const ACP_TERMINAL_DESTINATION: 'acp-terminal-state';
/**
 * ACP prompt 响应 `_meta` 上的取消原因键，也是 `session.meta` 上待下发原因的键。
 *
 * workbuddy-core（`conversation-terminal-error.ts`）、workbuddy-app adapter 不依赖
 * cbc-shared，各自持有同值字面量；改名或改值必须同步那两处。
 */
export declare const ACP_META_CANCEL_REASON: 'codebuddy.ai/cancelReason';
export declare const ACP_CANCEL_REASON_SANDBOX_APPROVAL_TIMEOUT: 'sandbox_approval_timeout';
/** 用户在「检测到模型可能循环」弹窗中选择了停止请求。 */
export declare const ACP_CANCEL_REASON_TOOL_CALL_LOOP_STOPPED: 'tool_call_loop_stopped';
/** 连续压缩达到上限后 CLI 主动结束本轮；实时响应与落盘终态共用。 */
export declare const ACP_CANCEL_REASON_COMPACT_LIMIT_REACHED: 'compact_limit_reached';
export type AcpCancelReason = typeof ACP_CANCEL_REASON_SANDBOX_APPROVAL_TIMEOUT | typeof ACP_CANCEL_REASON_TOOL_CALL_LOOP_STOPPED | typeof ACP_CANCEL_REASON_COMPACT_LIMIT_REACHED;
export declare function readAcpCancelReason(value: unknown): AcpCancelReason | undefined;
export interface CreateAcpTerminalStateItemOptions {
    /** 缺省用 uuidv7。 */
    id?: string;
    parentId: string;
    requestId: string;
    rootRequestId: string;
    attempt?: number;
    stopReason: string;
    timestamp: number;
    cost?: AcpTerminalStateItem['cost'];
    error?: AcpTerminalStateItem['error'];
    /** 合并在 `skipRun` / `acpTerminalState` 之后。 */
    providerData?: Record<string, unknown>;
}
export declare function createAcpTerminalStateItem(options: CreateAcpTerminalStateItemOptions): AcpTerminalStateItem;
//# sourceMappingURL=acp-terminal-state.d.ts.map