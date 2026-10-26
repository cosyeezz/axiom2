import { type NotificationInjectionBuffer, type NotificationInjectionEntry } from './notification-injection-buffer-protocol';
/**
 * NotificationInjectionBuffer 的默认实现（#89130）。
 *
 * 以会话 id 为索引暂存待注入的通知 XML 字符串。与 {@link SteerInputBufferImpl} 的关键
 * 区别：**不带 `ownerRequestId`**——后台通知不属于任何用户请求，drain 按 session 维度
 * 全量取出，不做归属校验（否则会把不匹配 requestId 的通知静默丢弃）。
 *
 * 完成通知保留原消息身份，在 has/drain 时排除 TaskOutput 已读结果；其余字符串与结构化
 * 通知原样保留。`clear` 在会话销毁时释放整段，避免长活进程下 Map 泄漏。
 */
export declare class NotificationInjectionBufferImpl implements NotificationInjectionBuffer {
    private readonly store;
    push(sessionId: string, entry: NotificationInjectionEntry): void;
    drain(sessionId: string): NotificationInjectionEntry[];
    has(sessionId: string): boolean;
    private pending;
    clear(sessionId: string): void;
}
//# sourceMappingURL=notification-injection-buffer.d.ts.map