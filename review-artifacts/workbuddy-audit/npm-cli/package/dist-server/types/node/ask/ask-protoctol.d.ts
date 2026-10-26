import { Deferred } from '@celljs/core';
import type { Span } from '@genie/telemetry';
import { BehaviorSubject } from 'rxjs';
import { RunToolApprovalItem } from '../../vendor/cbc-shared/node/index.js';
export declare const AskService: unique symbol;
export interface AskAnswers {
    [question: string]: string;
}
export interface AskService {
    /**
     * Set ask questions
     * @param item The tool approval item containing questions
     */
    setAsk(item: RunToolApprovalItem): void;
    /**
     * Start a user_input_wait span for the given toolCallId.
     * Called when the question is presented to the user (setAsk time),
     * not when acquireAnswers is called (which may be after the answer arrived).
     * @param toolCallId The tool call id for the question
     * @param rootSpan The conversation request root span to create the child span from
     * @param questionCount Number of questions asked
     * @param toolName Tool name (e.g. 'AskUserQuestion', 'Write', 'Bash') for distinguishing wait type
     */
    startWaitSpan(toolCallId: string, rootSpan: Span | undefined, questionCount: number, toolName?: string): void;
    /**
     * End the user_input_wait span for the given toolCallId.
     * Used by callers that manage span lifecycle externally (e.g. tool approval
     * in acp-agent.ts), as opposed to AskUserQuestion which ends via doneAsk/rejectAsk.
     * @param toolCallId The tool call id
     * @param success Whether the wait ended successfully
     * @param error Optional error if the wait failed
     */
    endWaitSpanExternal(toolCallId: string, success: boolean, error?: Error): void;
    /**
     * End and clear all still-open waitSpans (superseded/interrupted). Used by
     * conversation Stop / session teardown paths as a safety net against spans
     * left dangling when a toolCallId is superseded without a matching doneAsk/rejectAsk.
     * @param reason Recorded as the span's failure reason.
     */
    flushPendingWaitSpans(reason: string): void;
    /**
     * User completed answering questions.
     * If no deferred is waiting for the given toolCallId, the answers are buffered
     * in `earlyAnswers` and delivered to the next `acquireAnswers(toolCallId)`.
     *
     * @param answers User's answers to questions
     * @param toolCallId Optional tool call id for precise routing. When omitted,
     *                   falls back to the current ask item (legacy behavior).
     */
    doneAsk(answers: AskAnswers, toolCallId?: string): void;
    /**
     * User rejected/cancelled answering questions.
     * @param toolCallId Optional tool call id; when omitted, targets the current ask item.
     */
    rejectAsk(toolCallId?: string): void;
    /**
     * Await the answers for a specific tool call.
     * Returns immediately if `doneAsk` has already delivered answers (early arrival).
     * Otherwise registers a deferred under `toolCallId` and resolves when `doneAsk` fires.
     * Rejects if `rejectAsk` is called, the signal aborts, or `timeoutMs` elapses.
     *
     * @param timeoutMs Maximum wait time in milliseconds before rejecting with a
     *                  timeout error. Defaults to 10 minutes. Pass `0` (or any
     *                  non-finite value) to disable the timeout. The timeout is
     *                  a safety net against lost UI messages causing the tool
     *                  call to hang forever (see ask 工具确认框偶发卡死 root cause).
     */
    acquireAnswers(toolCallId: string, signal?: AbortSignal, timeoutMs?: number): Promise<AskAnswers>;
    /**
     * Diagnostic snapshot of internal routing state. Useful when debugging
     * "ask panel never resolved" reports — log this on suspected hangs.
     */
    getRoutingState(): {
        earlyAnswerKeys: string[];
        waitingDeferredKeys: string[];
        currentItemId: string | undefined;
    };
    /**
     * Get current ask item
     */
    getCurrentAskItem(): RunToolApprovalItem | undefined;
    /**
     * Reactive observable of the current ask item.
     *
     * 方案一后续：AskPanel 的读取源从 `session.interruptionSubject.value` 切到这里。
     * AskService 本来就是全局单例，天然不受 findMainSession fallback 造成的 session 错位影响。
     * 之前 AskPanel 直接读 session.interruptionSubject 会在多 agent 并发下偶现错位：
     * - 导航 hook 已通过 InterruptionService.pending$ 切到了正确的 panel
     * - 但 AskPanel 内部再读 session.interruptionSubject.value 时，item 已被投到错的 session
     * - 面板渲染看到 undefined，触发 "如果中断项消失但 askService 仍有待处理的 deferred" 自动清理
     * - 用户看到的现象：面板闪一下就消失 / 面板空白
     *
     * 切到 currentItem$ 后 AskPanel 与 AskService 的内部状态始终同步，不再依赖 session 订阅。
     */
    readonly currentItem$: BehaviorSubject<RunToolApprovalItem | undefined>;
    /**
     * Get current deferred promise.
     * @deprecated Prefer `acquireAnswers(toolCallId)` which avoids the
     *             early-arrival race that dropped answers (issue #32633).
     */
    getCurrentDeferred(): Deferred<AskAnswers> | undefined;
}
