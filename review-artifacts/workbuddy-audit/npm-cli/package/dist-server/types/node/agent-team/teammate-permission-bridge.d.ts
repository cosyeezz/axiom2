/**
 * 独立进程 teammate 的**审批回程**（issue #127405 · P6）。
 *
 * teammate 进程里没有 UI、没有 stream-json / SDK 通道，默认审批分支是「等 ACP 宿主应答」——
 * 没有宿主订阅时就是无声挂起（WAITING_FOR_PERMISSION，无超时、无默认决策）。
 * core 的 `canUseTool` 席位语义正是"这个会话的审批谁来答"：绑上它，leader 侧的用户来答
 * （leader 的 InterruptionService 弹审批，决策经 HTTP 回传到本进程）。
 *
 * 桥不可达时**不绑**：保持原行为（等宿主），别把审批降级成本地自动拒绝 ——
 * 「答不了」和「拒了」是两件事，后者会让 teammate 静默干不成活。
 */
import { type CanUseToolOwner, type Session } from '../../vendor/cbc-core/node/index.js';
import type { PermissionBridgeClient } from './permission-bridge-client';
/**
 * 把 leader 的 PermissionBridgeClient 绑成本会话的审批回调。返回解绑函数。
 *
 * 决策映射：allow / allowAll → 放行；其余（deny / rejectAndExitPlan）→ 拒绝并把
 * 原因带给模型（桥客户端自身在超时 / 网络失败时已经返回 deny，也走同一映射）。
 */
/**
 * 绑定结果：`unbind` 解绑（身份比对后清席位）；`replacedExisting` = 该会话原本已有
 * 审批席位（被我们顶掉，调用方应记一条日志 —— 与 a2a-agent-executor 的占位检查同一约定）；
 * `previousOwner` = 被顶掉席位的 owner，供日志定位「谁的席位被抢了」。
 */
export interface LeaderPermissionBridgeBinding {
    unbind: () => void;
    replacedExisting: boolean;
    previousOwner?: CanUseToolOwner;
}
export declare function bindLeaderPermissionBridge(session: Session, bridge: Pick<PermissionBridgeClient, 'requestPermission'>): LeaderPermissionBridgeBinding;
