import type { Observable } from 'rxjs';
import type { AgentRetryReason, Session } from './session-protocol';
export declare const SessionRunStateMachine: unique symbol;
export declare const SessionRunStateProjectionService: unique symbol;
export declare const SESSION_RUN_STATE_PROJECTION_SCHEMA: 'session-run-state.v1';
export declare const SESSION_RUN_SKIP_REASON_RECORD_ONLY: 'record-only';
export declare enum SessionRunStatus {
    IDLE = "idle",
    PREPARING = "preparing",
    PENDING = "pending",
    AGENT_RUNNING = "agent_running",
    MODEL_REQUESTING = "model_requesting",
    MODEL_STREAMING = "model_streaming",
    MODEL_DONE = "model_done",
    TOOL_EXECUTING = "tool_executing",
    WAITING_FOR_PERMISSION = "waiting_for_permission",
    WAITING_FOR_USER = "waiting_for_user",
    RETRYING = "retrying",
    COMPACTING = "compacting",
    CANCELLING = "cancelling"
}
export declare enum SessionRunLifecycle {
    IDLE = "idle",
    PREPARING = "preparing",
    RUNNING = "running",
    WAITING = "waiting",
    RETRYING = "retrying",
    COMPACTING = "compacting",
    CANCELLING = "cancelling"
}
export declare enum SessionRunEventType {
    RUN_PREPARING = "RUN_PREPARING",
    RUN_ACCEPTED = "RUN_ACCEPTED",
    RUN_SKIPPED = "RUN_SKIPPED",
    AGENT_STARTED = "AGENT_STARTED",
    AGENT_ENDED = "AGENT_ENDED",
    TOOL_STARTED = "TOOL_STARTED",
    TOOL_ENDED = "TOOL_ENDED",
    AGENT_HANDOFF = "AGENT_HANDOFF",
    MODEL_REQUEST_STARTED = "MODEL_REQUEST_STARTED",
    MODEL_STREAM_STARTED = "MODEL_STREAM_STARTED",
    MODEL_RESPONSE_DONE = "MODEL_RESPONSE_DONE",
    WAITING_FOR_PERMISSION = "WAITING_FOR_PERMISSION",
    WAITING_FOR_USER = "WAITING_FOR_USER",
    RETRYING = "RETRYING",
    COMPACT_STARTED = "COMPACT_STARTED",
    COMPACT_ENDED = "COMPACT_ENDED",
    COMPACT_FAILED = "COMPACT_FAILED",
    CANCEL_REQUESTED = "CANCEL_REQUESTED",
    RUN_FAILED = "RUN_FAILED",
    FORCE_IDLE = "FORCE_IDLE"
}
/**
 * compact 中断旧流后等待清理超时的 forceIdle reason（见 #88320）。
 *
 * 该 forceIdle 只是 compact 流程内部把状态拉回干净 idle 的过渡步骤，
 * 紧接着就会由 sendContinueMessage 发起续跑（RUN_PREPARING）。因此它**不应**
 * 对外 emit `phase=idle / AGENT_END` 假完成相位（否则 UI 会在 compact+续跑
 * 窗口短暂显示"已完成/已停止"）。状态机据此 reason 抑制 UI 投影，但仍保留核心
 * status 转换与 lastTransition（不影响队列 drain 资格）。
 */
export declare const FORCE_IDLE_REASON_COMPACT_ABORT_WAIT_TIMEOUT = "compact-abort-wait-timeout";
export declare enum SessionRunLegacyAgentState {
    AGENT_PENDING = "agent_pending",
    AGENT_START = "agent_start",
    AGENT_TOOL_START = "agent_tool_start",
    AGENT_TOOL_END = "agent_tool_end",
    AGENT_HANDOFF = "agent_handoff",
    AGENT_END = "agent_end"
}
export declare enum SessionRunProjectedPhase {
    IDLE = "idle",
    PREPARING = "preparing",
    MODEL_REQUESTING = "model_requesting",
    MODEL_STREAMING = "model_streaming",
    MODEL_DONE = "model_done",
    TOOL_EXECUTING = "tool_executing",
    WAITING_FOR_PERMISSION = "waiting_for_permission",
    WAITING_FOR_USER = "waiting_for_user",
    RETRYING = "retrying"
}
export interface SessionRunTransitionRecord {
    readonly event: SessionRunEventType;
    readonly from: SessionRunStatus;
    readonly to: SessionRunStatus;
    readonly reason?: string;
    readonly at: number;
}
export interface SessionRunStateSnapshot {
    readonly status: SessionRunStatus;
    /**
     * Process-local identity of the physical run admitted by the latest legal
     * `IDLE -> PREPARING` transition. It remains stable through the terminal
     * transition so subscribers can correlate admission and completion.
     */
    readonly runId?: string;
    readonly lastTransition?: SessionRunTransitionRecord;
}
export type SessionRunEvent = {
    type: SessionRunEventType.RUN_PREPARING;
    reason?: string;
} | {
    type: SessionRunEventType.RUN_ACCEPTED;
    reason?: string;
} | {
    type: SessionRunEventType.RUN_SKIPPED;
    reason?: string;
} | {
    type: SessionRunEventType.AGENT_STARTED;
    reason?: string;
} | {
    type: SessionRunEventType.AGENT_ENDED;
    reason?: string;
} | {
    type: SessionRunEventType.TOOL_STARTED;
    toolName?: string;
    toolCallId?: string;
    reason?: string;
} | {
    type: SessionRunEventType.TOOL_ENDED;
    toolName?: string;
    reason?: string;
} | {
    type: SessionRunEventType.AGENT_HANDOFF;
    reason?: string;
} | {
    type: SessionRunEventType.MODEL_REQUEST_STARTED;
    reason?: string;
} | {
    type: SessionRunEventType.MODEL_STREAM_STARTED;
    streamingToolName?: string;
    reason?: string;
} | {
    type: SessionRunEventType.MODEL_RESPONSE_DONE;
    reason?: string;
} | {
    type: SessionRunEventType.WAITING_FOR_PERMISSION;
    toolName?: string;
    reason?: string;
} | {
    type: SessionRunEventType.WAITING_FOR_USER;
    toolName?: string;
    reason?: string;
} | {
    type: SessionRunEventType.RETRYING;
    reason?: string;
    retryReason?: AgentRetryReason;
} | {
    type: SessionRunEventType.COMPACT_STARTED;
    reason?: string;
} | {
    type: SessionRunEventType.COMPACT_ENDED;
    reason?: string;
} | {
    type: SessionRunEventType.COMPACT_FAILED;
    reason?: string;
} | {
    type: SessionRunEventType.CANCEL_REQUESTED;
    reason?: string;
} | {
    type: SessionRunEventType.RUN_FAILED;
    reason?: string;
} | {
    type: SessionRunEventType.FORCE_IDLE;
    reason: string;
};
export interface SessionRunStateMachine {
    transition(session: Session, event: SessionRunEvent): SessionRunStateSnapshot;
    getSnapshot(session: Session): SessionRunStateSnapshot;
    getLifecycle(session: Session): SessionRunLifecycle;
    isBusy(session: Session): boolean;
    isIdle(session: Session): boolean;
    isBusyForQueue(session: Session): boolean;
    forceIdle(session: Session, reason: string): SessionRunStateSnapshot;
    /**
     * Process-level timestamp (epoch ms) of the last time any session run
     * completed — i.e. a `DRAIN_ELIGIBLE_IDLE_EVENTS` transition landed on
     * `IDLE`. Returns `null` if no run has ever completed in this process
     * (fresh start / after restart). Not tied to any specific session, so it
     * survives Web UI reloads and session switches. Consumed by
     * `GET /api/v1/status` for resource-release decisions.
     */
    getLastCompletedAt(): number | null;
    /**
     * Observable that fires once per legal transition (after legacy side effects).
     *
     * The observable carries no payload; subscribers should re-read state via
     * `getSnapshot()` / `getLifecycle()` / `isBusy()` / `isBusyForQueue()` /
     * `isIdle()` to keep a single source of truth.
     */
    getChange$(session: Session, skipFirst?: boolean): Observable<void>;
}
export declare const ModelRequestRetryPhase: unique symbol;
/**
 * 模型请求层（宿主 provider）在同一次请求内部退避重发时，借此把会话投影为 retrying。
 * 状态写入与守卫收口在 core，宿主只包住退避等待，不直接驱动状态机。
 */
export interface ModelRequestRetryPhase {
    /**
     * `wait` 期间会话显示 retrying，有 `reason` 时一并携带；缺省表示原因未分类（如上游 429 / 5xx）。
     * 结束（含抛错 / 取消）后恢复 model_requesting。
     * 非本轮主请求（无 session、辅助型 purpose、状态不在 model_requesting）时只执行 `wait`。
     */
    during<T>(session: Session | undefined, reason: AgentRetryReason | undefined, wait: () => Promise<T>): Promise<T>;
}
/**
 * Pure derivations from a `SessionRunStatus`. The state machine implementation
 * MUST keep its instance methods (`getLifecycle`, `isBusy`, etc.) consistent
 * with these helpers so consumers can use either entry point interchangeably.
 *
 * Hooks reading the snapshot returned by `useSessionRunStateSnapshot` should
 * use these helpers instead of re-reading via `stateMachine.getSnapshot()` —
 * that avoids a subtle inconsistency where a setState-driven render observes a
 * stale React state but a fresh `stateMachine.getSnapshot()` value.
 */
export declare function deriveSessionRunLifecycle(status: SessionRunStatus): SessionRunLifecycle;
export declare function isSessionRunStatusBusy(status: SessionRunStatus): boolean;
export declare function isSessionRunStatusIdle(status: SessionRunStatus): boolean;
export declare function isSessionRunStatusBusyForQueue(status: SessionRunStatus): boolean;
/**
 * 当前状态是否「确定还会发起模型请求 / 响应在途」，即可安全接受 steer（#85193）。
 *
 * `steered:true` 必须承诺消息最终注入：消息进缓冲后要靠下一次模型请求前的取出点
 * 注入。因此只有这些状态是安全的——
 * - `MODEL_REQUESTING` / `MODEL_STREAMING`：响应在途，消息 push 后下一次模型请求
 *   的取出点必然触发（配合 keep-alive 续圈），注入；
 * - `PENDING` / `AGENT_RUNNING` / `TOOL_EXECUTING` / `WAITING_*` / `RETRYING`：
 *   之后必再发起模型请求，下一次取出点注入；
 * 其余状态（`MODEL_DONE` 收尾 / `COMPACTING` / `CANCELLING` / `IDLE` / `PREPARING`）
 * 续圈时机不保证或不会注入，一律返回 `steered:false`，由上层保留消息降级普通发送，
 * 宁可下一轮发也不丢。
 */
export declare function isSteerableRunStatus(status: SessionRunStatus): boolean;
/**
 * Idle transitions a deferred queue drain is allowed to ride on.
 *
 * `isIdle()` alone is not enough: cancel recovery and `RUN_SKIPPED` also land on
 * `IDLE`, and draining there either steers a turn the user just stopped or races
 * the run that produced the skip. Only these four mean "the previous turn is
 * really over and nothing else is about to start".
 *
 * Shared by `IdleQueueDrainService` (Mode A `session.queue`) and
 * `BackgroundTaskNotifier` (deferred `<task-notification>` retry) so both ride
 * the same window.
 */
export declare const DRAIN_ELIGIBLE_IDLE_EVENTS: ReadonlySet<SessionRunEventType>;
export declare function isDrainEligibleIdleTransition(snapshot: SessionRunStateSnapshot): boolean;
export interface SessionRunStateProjectionOptions {
    readonly runId?: string;
    readonly updatedAt?: number;
}
export interface SessionRunStateProjection {
    readonly schema: typeof SESSION_RUN_STATE_PROJECTION_SCHEMA;
    readonly sessionId: string;
    readonly runId?: string;
    readonly sequence: number;
    readonly status: SessionRunStatus;
    readonly lifecycle: SessionRunLifecycle;
    readonly busy: boolean;
    readonly queueBusy: boolean;
    readonly lastTransition?: SessionRunTransitionRecord;
    readonly updatedAt: number;
}
export interface SessionRunStateProjectionService {
    project(session: Session, options?: SessionRunStateProjectionOptions): SessionRunStateProjection;
    reset(sessionId?: string): void;
}
//# sourceMappingURL=session-run-state-machine-protocol.d.ts.map