import { CustomError } from '@celljs/core';
/**
 * Custom error types for session management
 */
/**
 * Session 不存在错误
 * 尝试 resume/fork 一个不存在的 session 时抛出
 */
export declare class SessionNotFoundError extends CustomError {
    readonly sessionId: string;
    constructor(sessionId: string);
}
/**
 * Session ID 格式无效错误
 */
export declare class InvalidSessionIdError extends CustomError {
    readonly sessionId: string;
    constructor(sessionId: string);
}
/**
 * --resume-session-at 目标消息不存在错误
 *
 * 对齐 Claude Code v2.1.88 `print.ts:5111` 的 `No message found with message.uuid of: <id>`
 * 文案——SDK/CloudAgent 侧可据此做错误分类。
 */
export declare class SessionResumeAtNotFoundError extends CustomError {
    readonly messageId: string;
    constructor(messageId: string);
}
/**
 * Fork 操作失败错误
 * 找不到源 session 时抛出
 */
export declare class ForkOperationError extends CustomError {
    constructor(message?: string);
}
/**
 * Session 被中止错误
 * 通用的 session abort 错误
 */
export declare class SessionAbortedError extends CustomError {
    constructor(message?: string);
}
/**
 * 上下文压缩导致的 Session 中止错误
 * 当 compactAndSummarize 触发 abort 时抛出
 */
export declare class SessionCompactionAbortError extends CustomError {
    constructor();
}
/**
 * 用户主动中断错误
 * message 与 INTERRUPTED_BY_USER_MESSAGE 常量保持一致
 */
export declare class InterruptedByUserError extends CustomError {
    constructor();
}
/**
 * SDK 权限拒绝错误
 * SDK 模式下权限请求被拒绝时抛出
 * 注意：与 tool-protocol.ts 中的 PermissionDeniedError 不同，这是 SDK 层面的权限拒绝
 */
export declare class SdkPermissionDeniedError extends CustomError {
    readonly interrupt: boolean;
    constructor(reason?: string, interrupt?: boolean);
}
/**
 * 交互已被另一条通道抢答。
 *
 * 双通道场景专用：同一个 AskUserQuestion 同时推给了 A2A 和 stream-json，
 * 先答的一方生效，输的一方收到这个错误退场。
 *
 * **不能用 `SdkPermissionDeniedError(reason, true)` 代替**——那个 interrupt
 * 语义是「取消整轮」，会 abort 掉整个 session，而这里只是这条 bid 不再需要
 * 了，轮次必须照常跑下去。
 *
 * 经 `AbortController.abort(reason)` 传递：等待方从 `signal.reason` 取回它，
 * 于是不需要在包之间新增接口——cbc-a2a 依赖 cbc-core，反向不成立。
 */
export declare class InteractionSupersededError extends CustomError {
    readonly toolCallId: string;
    /** 谁抢答的，进日志用（如 `'stream-json'` / `'a2a'`）。 */
    readonly resolvedBy: string;
    constructor(toolCallId: string, 
    /** 谁抢答的，进日志用（如 `'stream-json'` / `'a2a'`）。 */
    resolvedBy: string);
}
/** `AbortSignal.reason` 是 unknown，判型收在一处，避免各处重复 instanceof。 */
export declare function supersededReasonOf(signal: AbortSignal): InteractionSupersededError | undefined;
/**
 * Agent 等待超时错误
 * 等待 agent_end 状态超时时抛出
 */
export declare class AgentTimeoutError extends CustomError {
    constructor(message?: string);
}
//# sourceMappingURL=session-errors.d.ts.map