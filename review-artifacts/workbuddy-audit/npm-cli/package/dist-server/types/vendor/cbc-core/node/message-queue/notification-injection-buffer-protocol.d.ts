/**
 * Notification Injection Buffer Protocol（#89130）
 *
 * 后台任务完成通知（`<task-notification>` / `<monitor-event>` 等）的「注入正在跑的一轮」
 * 交接缓冲。语义与 {@link SteerInputBuffer} 平行，但**刻意不带 `ownerRequestId`**：
 *
 * - steer 缓冲的消息由用户在某个具体请求执行中发出，天然归属那次请求的
 *   `conversationRequestId`，drain 时按归属放行、丢弃陈旧残留；
 * - 后台通知由 `bash-tool` 的 `.finally`（任务完成）触发，**与任何用户请求都没有因果
 *   关系**，不属于任何 `conversationRequestId`。若套用 steer 的归属校验，通知会因
 *   requestId 不匹配被静默丢弃。因此本缓冲按 **session 维度**暂存，语义是「注入到当前
 *   正在跑的任意一轮即可」，不校验 requestId。
 *
 * 为什么需要它、为什么它独立于消息队列（对齐 SteerInputBuffer 的设计）：
 * - 通知产生（任务完成回调）与模型执行不在同一段代码里，两者之间需要一小块按会话暂存
 *   的「待注入通知」缓冲；
 * - Mode B 下 `session.queue` 是 rich queue 的展示镜像，通知混进去需要靠归属过滤反复
 *   精确摘取（脆弱，见 #83856）。本缓冲把通知与 `session.queue` 彻底解耦。
 *
 * 消除隐形忙源（#89130 根治手段）：通知不再进 `session.queue` 起「独立 drain 黑盒轮」，
 * 而是 busy 期由正在跑的真实轮在模型请求前 drain 注入（`runner-factory` 来源三），
 * idle 期作为非空 input 直接起一轮。前端判忙看到的「忙」永远对应一个它能感知的真实轮，
 * 竞态窗口消失。
 */
import type { AgentInputItem } from '../../../cbc-shared/node/index.js';
export declare const NotificationInjectionBuffer: unique symbol;
export type NotificationInjectionEntry = string | AgentInputItem;
export interface NotificationInjectionBuffer {
    /**
     * 暂存通知 XML 或结构化消息（`<task-notification>…` / `<monitor-event>…` 等）。
     * 按 push 顺序保留；同一会话可多次 push（多个后台任务并发完成）。
     */
    push(sessionId: string, entry: NotificationInjectionEntry): void;
    /**
     * 丢弃 TaskOutput 已读的完成通知，取出并清空其余通知。无内容时返回空数组。
     * 在每次模型请求前（`callModelInputFilter`）与 idle 起轮前调用。
     */
    drain(sessionId: string): NotificationInjectionEntry[];
    /**
     * 该会话是否有待注入通知（不取出）。供 keep-alive 续圈判定
     * （`__codebuddySteerPending`）——还有通知没注入就让本轮续圈。
     */
    has(sessionId: string): boolean;
    /** 释放某会话的全部缓冲（会话销毁时调用，防长活进程下的 Map 泄漏与孤儿注入）。 */
    clear(sessionId: string): void;
}
//# sourceMappingURL=notification-injection-buffer-protocol.d.ts.map