import { type FunctionCallItem } from '../../../cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { type InterruptionService as InterruptionServiceInterface, type Session } from '../session/session-protocol';
import { type AgentLoopCancellation, AgentLoopInteraction, AgentLoopTelemetry } from './agent-runtime-protocol';
import { type ToolCallLoopGuard as ToolCallLoopGuardInterface, type ToolCallLoopGuardDecision } from './tool-call-loop-guard-protocol';
/**
 * 工具执行前的循环闸门实现。
 *
 * 生效范围被刻意收窄，但收窄分两档，两档的观测口径完全不同，别混着看：
 *
 * 一、完全惰性（`checkBeforeExecute` 顶部返回，连 record 都不做，零埋点）：
 *
 * 1. 非 WorkBuddy 宿主 / `CBC_LOOP_GUARD_DISABLED=1` —— 见 isEnabled()。这是硬开关不是
 *    降级，CodeBuddy Code CLI 场景本期不开，且要求行为与闸门上线前完全一致。
 * 2. 取不到 conversationRequestId —— 见 resolveTrackerKey()，没有可信的计数边界就不记账。
 *
 * 二、静默放行（已 record 命中，仍上报 suspected + auto_continue 保留观测口径，只是不弹窗）：
 *
 * 3. 无 ACP 连接、也没有宿主 canUseTool —— headless `-p` / SDK stream-json / print 模式弹不出窗。
 * 4. 后台任务会话 —— 没有人在屏幕前，弹窗只会把任务永久挂住。
 * 5. 子会话（subagent / team member）—— 弹窗要落到主会话 UI，但「停止请求」该中止
 *    哪一层的语义尚未定义，本期不引入这种歧义。
 * 6. 拿不到真实 tool_call id —— 见 resolveApprovalCallId()，合成 id 的审批卡在客户端
 *    上永远等不到配对的 tool_call，比不弹更糟。
 *
 * 第二档四条都在 resolvePromptBlocker() 里判，调用点在 decide() 内、report('suspected') 之后。
 * 放行事件用 `auto_continue` 而非 `continue`：混成一个会把「没人可问」算成用户选择，
 * 弹窗链路真出故障时大盘上看不出任何变化。
 */
export declare class ToolCallLoopGuardImpl implements ToolCallLoopGuardInterface {
    protected readonly logger: Logger;
    protected readonly loopInteraction: AgentLoopInteraction;
    private readonly trackers;
    /** 见 checkBeforeExecute 里的 single-flight 说明。key 与 trackers 同源。 */
    private readonly inflight;
    checkBeforeExecute(session: Session, toolName: string, toolCall?: FunctionCallItem): Promise<ToolCallLoopGuardDecision>;
    /**
     * 单次循环命中的完整决策流程。由 checkBeforeExecute 经 single-flight 唯一驱动。
     *
     * 整体 fail-open：本方法一旦抛出，所有复用同一 promise 的并发调用方会一起把异常
     * 抛进 executeToolWithHooks，把一次观测能力变成工具执行失败。
     */
    private decide;
    /**
     * Legacy CLI 先上报再取消。v2 Client 的明确 loop Stop 已取消信号，
     * 退费累加器按该原因允许清算；普通取消与迟到回调不进入这里。
     */
    private handleStop;
    /**
     * 按「用户取消」终止本轮请求。
     *
     * 复用 `AcpAgent.cancel` 而不是直接 `abortController.abort()`：前者是 ESC / 取消按钮
     * 走的同一条路径，AcpView 订阅后会完成拒绝待审批项、退出 plan mode、收尾 in_progress
     * todo、广播 tool_call_update(failed)、重置 isCompressing、清 progress 这一整套善后，
     * 并让 prompt 以 `stopReason: 'cancelled'` 收口。
     */
    private cancelTurn;
    /**
     * 弹窗并等待用户决策。resolve `true` = 继续执行，`false` = 停止请求。
     */
    private prompt;
    /**
     * 宿主经 canUseTool 回答（进程内没有 ACP 连接，审批队列无人读取）。卡片与超时同 ACP：
     * 超时或本轮取消时撤回卡片并按停止处理。
     */
    private promptHost;
    /**
     * 复用 sandbox intercept 合成审批项通道：ACP `requestPermission`、Desktop/Web 弹窗渲染、
     * 以及 `cancelAllForSession` 的统一收尾都已经在这条链路上跑通，无需另起一套。
     *
     * `callId` 必须是有 tool_call 背书的真实 id，由 resolveApprovalCallId 保证。绝不能在
     * 这里兜底生成本地 UUID：acp-agent 会按同 id 等一个 tool_call deferred，随机 id 永远
     * 等不到对应的 sessionUpdate，审批卡不可见，30 分钟后按超时停止收口，表现为请求被
     * 莫名终止。mcp-server-manager 的 loopGuardCallId 受同一约束。
     */
    private buildApprovalItem;
    /** 卡片展示用的元数据，ACP 与宿主 canUseTool 共用。 */
    private buildApprovalMetadata;
    protected isEnabled(): boolean;
    /** 不能弹窗的原因；undefined 表示可以弹。拆出来是为了让日志能区分降级与故障。 */
    protected resolvePromptBlocker(session: Session, approvalCallId: string | undefined): 'background_task' | 'sub_session' | 'no_acp_agent' | 'no_tool_call_id' | undefined;
    /**
     * 计数口径是「单次请求」，因此用 conversationRequestId 做 key；拿不到就不记账，
     * 避免把多轮请求的调用混进同一个计数器。
     */
    private resolveTrackerKey;
    private getTracker;
    private prune;
    private report;
    protected getInterruptionService(): InterruptionServiceInterface | undefined;
    protected getTelemetryService(): AgentLoopTelemetry | undefined;
    /**
     * `AcpAgent` 注册为 `Scope.Request`，直接 `ContainerUtil.get` 会拿到没人订阅的孤立实例，
     * 必须经 `AcpAgentManager` 取当前连接上的活实例。
     *
     * 解析策略与 `AcpView.resolveDrainAgent` 对齐：`session.meta.acpConnectionId` 只是线索
     * 不是权威。它在客户端重连（换了新 connectionId）或第二个客户端加载同一 session
     * （直接覆盖 meta）之后会指向一条已经从 manager 摘掉的死连接，`acp-terminal-publisher`
     * 的设计要点第一条记的就是同一个坑。裸用它的后果在本能力上尤其隐蔽：取不到 agent 时
     * `resolvePromptBlocker()` 把命中判成非交互环境，自动继续并 reset，用户永远等不到弹窗。
     *
     * 因此先按 connectionId 取并校验它确实绑在本 session 上，失败再按 session 扫一遍活实例。
     */
    protected getAcpAgentForSession(session: Session): AgentLoopCancellation | undefined;
}
//# sourceMappingURL=tool-call-loop-guard-service.d.ts.map