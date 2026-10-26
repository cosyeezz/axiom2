import type { SessionInterruptionInteractionHost } from './session-interruption-host-protocol';
import type { Session } from './session-protocol';
/** 双通道覆盖范围。工具授权（`all`）尚未解锁，见 `resolveDualChannelMode`。 */
export type DualChannelMode = 'off' | 'ask' | 'all';
export declare const DUAL_CHANNEL_ENV_KEY = "CODEBUDDY_A2A_DUAL_CHANNEL_INTERACTION";
/**
 * A2A inbound 在自己的 `execute()` 期间写进 `session.meta` 的本轮开关，
 * 轮次结束清除。它同时承担两个职责：
 *
 * 1. 承载调用方经 `message.metadata.codebuddy.dualChannelInteraction` 下发的
 *    单次覆盖（优先级高于环境变量）；
 * 2. 作为「本轮由 A2A 发起」的标记——没有它就说明这一轮是 stream-json 用户
 *    消息驱动的，不该双发。
 *
 * 用 meta 传值而不是让 core 去 import cbc-a2a：包依赖方向是
 * cbc-a2a → cbc-core，反过来不成立。
 */
export declare const DUAL_CHANNEL_SESSION_META_KEY = "a2aDualChannelInteraction";
export interface DualChannelSessionMarker {
    /** 调用方下发的单次覆盖；缺省表示「按环境变量」。取值不受信，统一归一化。 */
    mode?: string;
}
/** 这条拒绝是对端合成的，还是真有人点了拒绝。 */
export declare function isSyntheticDeny(reason: string | undefined): boolean;
/**
 * 「这条 deny 是合成的，已被忽略」。单独成类型是为了让竞速层能把它和普通
 * 故障区分开——普通故障是基础设施问题，这个是对端替用户做了决定，属于需要
 * 盯的异常态，日志级别不同。
 */
export declare class SyntheticDenyIgnoredError extends Error {
    readonly reason: string;
    constructor(reason: string);
}
/**
 * 放行回包里到底带没带答案。
 *
 * AskUserQuestion 的「放行」必须携带 answers，否则工具拿不到答案，会落到
 * AskService 去等一个永远不会来的 UI 回复。
 */
export declare function hasAskAnswers(updatedInput: Record<string, unknown> | undefined): boolean;
/**
 * A2A inbound 在自己的轮次开始时登记，轮次结束清除。`mode` 缺省表示
 * 「调用方没指定，按环境变量走」。meta key 不对外暴露，只经这两个函数读写。
 */
export declare function setDualChannelRunMarker(session: Session, mode: string | undefined): void;
export declare function clearDualChannelRunMarker(session: Session): void;
/** 一次审批在某条通道上的结果。两条通道的返回形状不同，在此收敛。 */
export type DualChannelOutcome = {
    kind: 'allow';
    updatedInput?: Record<string, unknown>;
} | {
    kind: 'deny';
    reason: string;
    interrupt?: boolean;
};
export type DualChannelBidId = 'a2a' | 'stream-json';
/**
 * 为什么撤销这条 bid —— 两种原因的下游语义完全不同，不能混为一谈：
 *
 * - `superseded`：另一条通道答了，本轮**要继续跑**。A2A 侧据此把 Task 拨回
 *   WORKING，绝不能 abort session。
 * - `abandoned`：整次审批异常退出（session 被取消、两条通道都故障）。这时
 *   本轮不会继续，A2A 侧必须按**真取消**处理，走原有的取消语义。
 *
 * 早期版本只有一个 `dismiss(winner)`，于是异常路径要么不撤销、要么被迫伪装成
 * 「被抢答」——前者让两侧的卡片都挂死，后者让调用方以为问题已被别人回答。
 */
export type DualChannelDismissal = {
    kind: 'superseded';
    winner: DualChannelBidId;
} | {
    kind: 'abandoned';
};
export interface DualChannelBid {
    id: DualChannelBidId;
    /** 返回结果 = 用户决定；抛异常 = 故障，退出竞速。 */
    run(): Promise<DualChannelOutcome>;
    /** 撤销自己那一侧的待决请求。必须幂等：正常与异常路径都可能调到。 */
    dismiss(cause: DualChannelDismissal): void;
}
export interface DualChannelWinner {
    id: DualChannelBidId;
    outcome: DualChannelOutcome;
}
export interface DualChannelDecision {
    enabled: boolean;
    /** 未启用的原因，直接进日志——线上排查「为什么没双发」全靠它。 */
    declineReason?: string;
    /** 生效档位，仅在 `enabled` 为真时有意义。 */
    mode?: DualChannelMode;
}
/**
 * 判定本次审批是否走双通道。任一条件不满足立即返回并带上原因；
 * 返回 `enabled: false` 时调用方必须走今天那条原有的 if / else-if 链。
 */
export declare function resolveDualChannelInteraction(session: Session, toolName: string, interactionHost: Pick<SessionInterruptionInteractionHost, 'resolveAskHandler' | 'supportsStreamJsonAskUserQuestion'>, warn?: (message: string) => void): DualChannelDecision;
//# sourceMappingURL=dual-channel-interaction.d.ts.map