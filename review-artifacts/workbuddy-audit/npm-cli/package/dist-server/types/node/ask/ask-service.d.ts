import { Deferred } from '@celljs/core';
import { Logger, type Span } from '@genie/telemetry';
import { BehaviorSubject } from 'rxjs';
import { RunToolApprovalItem } from '../../vendor/cbc-shared/node/index.js';
import { AskAnswers, AskService } from './ask-protoctol';
export declare class AskServiceImpl implements AskService {
    protected readonly logger: Logger;
    private currentDeferred;
    private currentItem;
    /**
     * Reactive observable of the current ask item。
     *
     * AskPanel 订阅此 subject 代替旧的 `session.interruptionSubject.value` 读取，
     * 避免多 agent 并发下因 findMainSession fallback 导致 ask item 投递到错的 session。
     * AskService 本来就是 DI 单例，天然绕过 session 错位。
     */
    readonly currentItem$: BehaviorSubject<RunToolApprovalItem | undefined>;
    /**
     * Answers delivered by `doneAsk` before any `acquireAnswers` was waiting.
     * Keyed by toolCallId so late-starting tool executions can still pick them up.
     * See issue #32633: ACP approval used to race ahead of `execute()` creating the
     * deferred, causing the answer to be dropped and the tool to see "No Question".
     */
    private earlyAnswers;
    /**
     * Deferreds registered by `acquireAnswers`, waiting for `doneAsk` to arrive.
     */
    private waitingDeferreds;
    /**
     * Active user_input_wait spans keyed by toolCallId.
     * Created in `startWaitSpan` (when the question is presented to the user),
     * ended in `doneAsk` / `rejectAsk` (when the answer arrives).
     */
    private waitSpans;
    init(): void;
    startWaitSpan(toolCallId: string, rootSpan: Span | undefined, questionCount: number, toolName?: string): void;
    private endWaitSpan;
    endWaitSpanExternal(toolCallId: string, success: boolean, error?: Error): void;
    /**
     * 兜底：结束并清空所有仍未 end 的 waitSpans。用于 conversation Stop / session 关闭路径，
     * 覆盖 setAsk 覆盖链之外仍可能残留的 span（例如整轮对话中断、面板未来得及触发 rejectAsk）。
     */
    flushPendingWaitSpans(reason: string): void;
    setAsk(item: RunToolApprovalItem): void;
    doneAsk(answers: AskAnswers, toolCallId?: string): void;
    rejectAsk(toolCallId?: string): void;
    /**
     * @param timeoutMs Defaults to 10 minutes. Pass `0` (or non-finite) to disable.
     *                  Safety net against UI messages getting lost (e.g. ACP / IPC
     *                  channel races, AskPanel cleanup竞速) that would otherwise
     *                  leave the tool call hanging forever.
     */
    acquireAnswers(toolCallId: string, signal?: AbortSignal, timeoutMs?: number): Promise<AskAnswers>;
    getCurrentAskItem(): RunToolApprovalItem | undefined;
    getCurrentDeferred(): Deferred<AskAnswers> | undefined;
    getRoutingState(): {
        earlyAnswerKeys: string[];
        waitingDeferredKeys: string[];
        currentItemId: string | undefined;
    };
    private cleanup;
}
