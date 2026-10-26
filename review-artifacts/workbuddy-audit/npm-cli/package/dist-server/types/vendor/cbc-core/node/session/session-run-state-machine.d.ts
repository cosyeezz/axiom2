import { Logger } from '@genie/telemetry';
import { type Observable } from 'rxjs';
import type { Session } from './session-protocol';
import { SessionRunEvent, SessionRunEventType, SessionRunLifecycle, SessionRunStateMachine, SessionRunStateSnapshot, SessionRunStatus } from './session-run-state-machine-protocol';
export declare const SESSION_RUN_TRANSITIONS: Record<SessionRunStatus, Partial<Record<SessionRunEventType, SessionRunStatus>>>;
export declare class SessionRunStateMachineImpl implements SessionRunStateMachine {
    protected readonly logger?: Logger;
    /**
     * 进程级"上次任务完成时间"（epoch ms）。
     *
     * 在完成类事件（`DRAIN_ELIGIBLE_IDLE_EVENTS`：AGENT_ENDED / RUN_FAILED /
     * COMPACT_FAILED / FORCE_IDLE）落到 IDLE 时更新为 `Date.now()`。
     * 与具体 session 对象无关——跨会话、跨 Web UI 刷新均可靠；进程重启后归零为
     * `null`（资源释放场景下合理：进程重启意味着资源已释放）。
     * 由 `GET /api/v1/status` 读取用于资源释放决策。
     */
    private processLastCompletedAt;
    private readonly runCounters;
    getLastCompletedAt(): number | null;
    /**
     * 状态机唯一写入口。
     *
     * 根据当前 `session.runState.status` 和传入事件查询 `SESSION_RUN_TRANSITIONS`：
     * - 如果转换表允许该 `from status + event`，则写入新的 `status`，并记录 `lastTransition.from/to/event`。
     * - 如果转换表不允许，则保持原状态不变，也不会触发 legacy `agentState` 或 `phaseSubject` side effect。
     *
     * 注意：这里只扭转核心 `status`；`agentState` 和 `phaseSubject` 都只是兼容输出。
     */
    transition(session: Session, event: SessionRunEvent): SessionRunStateSnapshot;
    /**
     * 获取当前核心状态快照。
     *
     * `runState.status` 是状态机唯一事实来源。这里不会从 legacy `agentState`
     * 或 UI 投影 `phaseSubject` 反推核心状态，避免旧字段反向污染状态机。
     */
    getSnapshot(session: Session): SessionRunStateSnapshot;
    /**
     * 获取派生生命周期。
     *
     * `lifecycle` 不作为独立状态存储，而是由当前 `status` 派生，
     * 用于外部需要粗粒度判断时读取，例如 running / waiting / retrying。
     */
    getLifecycle(session: Session): SessionRunLifecycle;
    /**
     * 状态机主视角的 busy 判断。
     *
     * 除 `idle` 外，其他 status 都表示当前 Session Run 仍处于处理中。
     * 这个判断不等同于队列路由判断。
     */
    isBusy(session: Session): boolean;
    /**
     * 状态机主视角的 idle 判断。
     *
     * 只是 `isBusy()` 的反向语义，用于提升调用方可读性。
     */
    isIdle(session: Session): boolean;
    /**
     * 队列路由专用 busy 判断。
     *
     * `preparing` 阶段不算 queue busy，因为此时 run 还在进入 interceptor 前后，
     * 如果 queue 在这个阶段判断 busy，会导致首个请求被错误入队。
     * 真正进入 `pending` 后才算 queue busy。
     */
    isBusyForQueue(session: Session): boolean;
    /**
     * 强制恢复到 idle。
     *
     * 用于 PTL recovery、compact 前恢复、interruption error recovery、sub-agent resume
     * 等补偿场景。它通过 `FORCE_IDLE` 事件走同一套转换表和 side effect 逻辑。
     */
    forceIdle(session: Session, reason: string): SessionRunStateSnapshot;
    /**
     * 状态变更通知源。
     *
     * 直接订阅 `session.runStateSubject`，每次合法 transition（由 `apply()`
     * 写 `session.runState` 触发，setter 内部 dedupe 后 `runStateSubject.next()`）
     * 都会推一次新 snapshot。
     *
     * **保留 BehaviorSubject 的初始 replay 语义**：订阅瞬间会立即收到当前
     * snapshot，与 legacy `agentStateSubject.subscribe()` 行为一致。需要"只关
     * 心后续 transition"的消费方可以自行 `pipe(skip(1))` 或用一个本地标志位
     * 跳过第一次回调。
     *
     * Observable 不携带 payload（`mapTo(undefined)`），订阅者应通过
     * `getSnapshot()` 等读 API 拿权威状态，避免出现"双事实源"。
     *
     * 旧 session（缺 `runStateSubject`）返回 EMPTY，避免外部 hook crash；
     * 这条降级路径只用于尚未升级的测试 stub，生产代码应始终初始化该字段。
     */
    getChange$(session: Session, skipFirst?: boolean): Observable<void>;
    /**
     * 记录一次合法状态转换，作为 CLI canonical run state 的排查日志。
     *
     * 上层如果出现 loading / stop button / busy 状态异常，应先用这些日志确认 CLI
     * 状态机是否已经按预期完成转换，再继续排查 ACP 投影、main 缓存或 render 消费。
     */
    private logTransition;
    /**
     * 记录被转换表拒绝的事件。
     *
     * 这类日志通常意味着 late event、重复事件或上层投影顺序问题。状态机本身会保持
     * 当前状态不变，避免旧事件把 CLI 状态拉回异常状态。
     */
    private logInvalidTransition;
    private formatLogFields;
    private getEventToolName;
    private getEventStreamingToolName;
    /**
     * 应用一次合法状态转换。
     *
     * 该方法负责：
     * 1. 写入新的 `session.runState.status`。
     * 2. 记录 `lastTransition`，包含 from / to / event / reason。
     * 3. 根据 side effects 同步 legacy `agentState` / `agentStateSubject`。
     * 4. 根据 side effects 将核心 status 投影到 `phaseSubject`。
     */
    private nextRunId;
    private apply;
    /**
     * 为状态事件生成兼容 side effect。
     *
     * 核心状态机只存 `status`，但 PR1/PR2 期间仍需兼容现有系统：
     * - `agentState` / `agentStateSubject`：供 Queue、ACP、Team 等旧逻辑消费。
     * - `phaseSubject`：供 TUI / Web UI / ACP loading 展示消费。
     *
     * 该方法只描述“这次合法转换需要额外输出什么”，不决定核心状态怎么转。
     */
    private createSideEffects;
    /**
     * 将核心 `status` 投影为现有 `AgentPhaseInfo`。
     *
     * `AgentPhase` 不是核心状态，只是 UI / ACP loading 的展示输出。
     * `toolName` / `streamingToolName` 只来自当前事件 payload，不会写入 `runState`。
     */
    private projectAgentPhase;
    /**
     * 从当前事件中提取 phase projection 所需的临时展示元信息。
     *
     * 这些字段只用于本次 `phaseSubject.next()`，不进入 `SessionRunStateSnapshot`，
     * 避免 UI 展示元数据成为核心状态的一部分。
     */
    private phaseMetadataFromEvent;
    /**
     * 将核心 status 映射为 legacy `AgentPhase`。
     *
     * 该映射只服务展示层。对于 `agent_running`、`compacting`、`cancelling`
     * 这类没有明确 loading phase 的状态，默认投影为 `idle`，并且只有在
     * side effect 明确要求 emit phase 时才会真正写入 `phaseSubject`。
     */
    private phaseFromStatus;
    /**
     * 将细粒度 status 派生为粗粒度 lifecycle。
     *
     * lifecycle 不是第二份核心状态，只是对 `status` 的聚合视图，
     * 方便调用方做较粗粒度的状态判断。复用协议级 `deriveSessionRunLifecycle`
     * 保证 hook 与状态机派生规则只有一份实现。
     */
    private lifecycleFromStatus;
    /**
     * 判断某个 status 对队列路由是否 busy。
     *
     * 与 `isBusy()` 不同，`preparing` 不算 queue busy，只有 run 进入 `pending`
     * 或后续执行态后，新的输入才应该被队列拦截。复用协议级
     * `isSessionRunStatusBusyForQueue` 保证规则单一来源。
     */
    private isQueueBusyStatus;
}
//# sourceMappingURL=session-run-state-machine.d.ts.map