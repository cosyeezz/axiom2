/**
 * Steer Input Buffer Protocol（#85193）
 *
 * 「立即插入正在执行的一轮」的交接缓冲：`session/steer` 方法把用户在 Agent 执行中
 * 新发的消息暂存进来，模型请求前把缓冲里的消息全部取出、拼进模型输入。
 *
 * 为什么需要它、为什么它独立于消息队列：
 * - 请求处理与模型执行不在同一段代码里：`session/steer` 只是把消息收下，真正把
 *   消息喂给模型要等下一次模型请求边界。因此两者之间必须有一小块按会话暂存的
 *   「待插入消息」缓冲。
 * - 排队状态归上层前端；agent-cli 后续不再维护队列，现有 `RichMessageQueueManager`
 *   将移除。本缓冲刻意**不**依赖它：只暂存「待插入的几条消息」，无 id / 顺序 /
 *   编辑 / 持久化，队列移除后独立存在。
 *
 * 语义与 Codex `turn/steer` 的 pending 输入对齐（见
 * `docs/codex-app-server-steer-protocol.md` §7）。
 *
 * 归属语义（防跨轮误注入）：`isSteerableRunStatus` 只保证 push 那一刻会话在「还会
 * 发起模型请求」的状态，但 push 到drain 之间当前 run 仍可能异常终止（ESC 打断 /
 * RUN_FAILED / RUN_SKIPPED → IDLE），此后消息会滞留缓冲、在下一个无关 turn 被 drain
 * 注入。为杜绝此问题，push 时记下「归属哪一次请求」（`ownerRequestId`），drain 时只放行
 * 归属当前请求的消息，归属其它请求的陈旧消息一并丢弃。会话销毁时用 `clear` 释放，
 * 避免长活进程（--serve/daemon）下的 Map 泄漏与 sessionId 复用后的孤儿注入。
 */
import type { UserMessageItem } from '../../../cbc-shared/node/index.js';
export declare const SteerInputBuffer: unique symbol;
/** Buffer ownership only; consumption does not acknowledge transcript insertion. */
export type SteerInputDisposition = 'consumed' | 'cancelled' | 'discarded';
/**
 * drain 返回的一组：待插入内容 + 独立对账 id + 客户端不透明 metadata。
 */
export interface SteerDrainedGroup {
    /** Set only after the host validates a one-time mod prompt receipt. */
    readonly modsPromptSubmitted?: true;
    /**
     * 待插入的用户消息，与普通 prompt 同构（可含 `input_image`，#140576）。
     * 按引用保留，内存中的准入标记（WeakMap）随对象传递。
     */
    readonly messages: readonly UserMessageItem[];
    /**
     * 客户端为本条用户消息提供的不透明对账 id。存在时，CLI 在真正注入后原样回贴；
     * 同时落为历史 user item.id，保证回放身份一致；不存在时不产生实时回执。
     * 它与业务 metadata 相互独立。
     */
    readonly clientUserMessageId?: string;
    /**
     * 客户端在 `session/steer` 通过 `_meta` 传入的不透明数据。agent-cli **不解读**、原样透传：
     * 落盘时挂到
     * 该 steer 历史项的 `providerData.clientMeta`，供业务侧（如 WorkBuddy）在重放/重开时
     * 区分 steer 消息（归类 / 隐藏 / 禁用编辑）。`undefined` 表示本组无附带 metadata。
     */
    readonly clientMeta?: unknown;
}
/**
 * pushMessages 的归属 + 客户端不透明 metadata 入参（合并为一个对象，避免参数过多）。
 */
export interface SteerPushInput {
    /** Server-only provenance, independent of untrusted clientMeta. */
    readonly modsPromptSubmitted?: true;
    /**
     * 这组消息归属的请求 id（当前正在执行的 turn 的 requestId）；
     * `undefined` 表示无归属信息（drain 时按「当前也无归属」放行，退化为旧行为）。
     */
    readonly ownerRequestId: string | undefined;
    /**
     * 客户端为本条用户消息提供的不透明对账 id；只控制注入完成后的实时回执。
     */
    readonly clientUserMessageId?: string;
    /**
     * 客户端 `_meta` 里的不透明数据，agent-cli 不解读、原样存到 drain 返回值；
     * `undefined` 表示本次 steer 无附带 metadata（退化为旧行为，落盘裸记录）。
     */
    readonly clientMeta?: unknown;
}
export interface SteerInputBuffer {
    /**
     * 暂存一组待插入的用户消息（一次 steer 一组）。同一次请求执行里可被调用多次（用户连发多条）。
     * 转移所有权：调用方必须先 clone / 审查，交出后不得再修改。
     * Aborting withdraws only this submission while buffered. Drain and cancellation are
     * synchronous, so exactly one wins. Once consumed, cancellation cannot retract the input.
     * Clear or a stale owner discards it. The consumption promise never rejects.
     */
    pushMessages(sessionId: string, messages: readonly UserMessageItem[], input: SteerPushInput, signal?: AbortSignal): Promise<SteerInputDisposition>;
    /**
     * 取出并清空当前会话的全部待插入消息（取出即视为已消费）。
     * 只返回归属 `currentRequestId` 的消息；归属其它请求的陈旧残留一并丢弃、不注入。
     * 无内容时返回空数组。在每次模型请求前调用。
     */
    drain(sessionId: string, currentRequestId: string | undefined): SteerDrainedGroup[];
    /**
     * 当前会话是否有归属 `currentRequestId` 的待插入消息（不取出）。
     * 供 keep-alive 续圈判定——只有属于当前请求的消息才该让本轮续圈。
     */
    has(sessionId: string, currentRequestId: string | undefined): boolean;
    /** 释放某会话的全部缓冲（会话销毁时调用，防泄漏与孤儿注入）。 */
    clear(sessionId: string): void;
}
//# sourceMappingURL=steer-input-buffer-protocol.d.ts.map