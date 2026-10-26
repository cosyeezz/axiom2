/**
 * 沙箱审批请求的共享判定（bash / PowerShell 复用）。
 *
 * 抽离自 `bash-sandbox-approval-requester.ts`，让两个工具的「bypass 模式是否
 * 自动放行」判定单点收口，避免分叉（此前 PowerShell 漏了网络拦截处理）。
 */
import type { SandboxApprovalRequest } from '../permission';
/**
 * 网络拦截记录中是否存在「需要用户决策」的 reason（即使 bypass/fullAccess 模式也不自动放行）。
 *
 * 判定源是 Center `DecisionRecord` 投影出的 reason 枚举，而非 TS 侧
 * `interceptReason` 字符串——Center 已按 HttpIntercept rules 表判定三态并写入
 * reason，TS 据此决定是否必须弹窗。当前仅 `http_intercept_ask`（HTTP 明文拦截
 * 询问态）属于此列；其余 reason（block/黑名单等）由各自 post-exec 路径处理，
 * 不影响 bypass 自动放行判定。
 *
 * pre-exec 模式无 `sandboxResult`，返回 false（不排除 bypass 自动放行）。
 */
export declare function needsUserDecisionForNetworkBlock(request: SandboxApprovalRequest): boolean;
