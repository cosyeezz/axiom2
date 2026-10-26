import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Agent, AgentSideConnection, AuthenticateRequest, AuthenticateResponse, AvailableCommand, CancelNotification, ClientCapabilities, ContentBlock, InitializeRequest, InitializeResponse, LoadSessionRequest, LoadSessionResponse, McpServer, NewSessionRequest, NewSessionResponse, PermissionOption, PlanEntry, PromptRequest, PromptResponse, ReadTextFileRequest, ReadTextFileResponse, RequestError, SessionConfigOption, SessionNotification, SetSessionConfigOptionRequest, SetSessionConfigOptionResponse, SetSessionModeRequest, SetSessionModeResponse, StopReason, Stream, TerminalHandle, TerminalOutputResponse, ToolCallContent, ToolCallLocation, ToolCallStatus, ToolKind, WriteTextFileRequest, WriteTextFileResponse } from '@agentclientprotocol/sdk';
import type { Deferred } from '@celljs/core';
import type { ModelInfo, PermissionDecision, SecurityReviewConclusion, SetSessionModelRequest, SetSessionModelResponse } from '@genie/agent-client-protocol';
import type { CheckpointBroadcastEvent, CheckpointBroadcastInfo } from '@genie/cbc-checkpoint';
import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { PermissionMode, RunToolApprovalItem } from '../../vendor/cbc-shared/node/index.js';
import type { W3CTraceContextMeta } from '@genie/telemetry';
import type { Subject } from 'rxjs';
import type { CommonRequest } from '../loopback/server-protocol';
import type { McpFirstRunStatusEvent } from '../mcp/mcp-first-run-status-protocol';
export * from './acp-kernel-protocol';
/**
 * 上下文消耗 5 类目细拆 schema。
 *
 * 通过 `usage_update._meta['codebuddy.ai/usageByCategory']` 命名空间下发；
 * `'stream'` / `'model_changed'` 路径不附带（客户端复用上一次值），其余语义快照路径附带。
 *
 * sum(systemPrompt + conversation + tools + mcp + skills) === usage_update.used。
 */
export type { UsageByCategory } from './usage-by-category-calculator';
export declare const AcpServer: unique symbol;
export declare const AcpAgent: unique symbol;
export declare const AcpTransportManager: unique symbol;
export declare const AcpTransportFactory: unique symbol;
export declare const AcpTransport: unique symbol;
export declare const AcpStreamManager: unique symbol;
export declare const AcpView: unique symbol;
export declare const AcpAgentManager: unique symbol;
export declare const AcpConnectionGuard: unique symbol;
export declare const AcpBroadcastService: unique symbol;
export declare const AcpUsagePublisher: unique symbol;
export declare const AcpTerminalPublisher: unique symbol;
export declare const DelegateTool: unique symbol;
export type ResumeSessionRequest = LoadSessionRequest;
export type ResumeSessionResponse = LoadSessionResponse;
/**
 * MCP Apps UI 渲染载荷，封进 `tool_call_update._meta['codebuddy.ai'].toolMetaData.mcpUi`。
 * 字段对齐 `@mcp-ui/client` 的 `AppRenderer` props，供 Web UI 直接渲染。
 */
export interface McpUiBroadcastPayload {
    /** UI 资源 URI（ui://...），对应 AppRenderer.toolResourceUri */
    toolResourceUri: string;
    /**
     * 真实 MCP 工具全名（mcp__server__tool）。Web UI 用它解析 serverName 做
     * onReadResource/onCallTool 回拉。必须独立携带 —— MCP 工具经 DeferExecuteTool
     * 包装后 ToolCallEntry.toolName 是 "DeferExecuteTool"，解析不出 serverName。
     */
    toolName?: string;
    /** UI 资源 MIME，正常为 text/html;profile=mcp-app */
    mimeType?: string;
    /** 预取的 UI HTML（AppRenderer.html）。超阈值时省略，由 Web UI 经 onReadResource 回拉 */
    html?: string;
    /** CSP 约束（资源 _meta.ui.csp） */
    csp?: {
        connectDomains?: string[];
        resourceDomains?: string[];
        frameDomains?: string[];
        baseUriDomains?: string[];
    };
    /** iframe 权限（资源 _meta.ui.permissions） */
    permissions?: Record<string, unknown>;
    /** 是否倾向显示边框（资源 _meta.ui.prefersBorder） */
    prefersBorder?: boolean;
    /**
     * 与 `html` 同一次 `resources/read` 取回的完整 `_meta.ui`，Host 回放时消费
     * （理由见 workbuddy-server `OpenHostAppParams.uiMetadata`）。
     * 上面三个扁平字段是它的旧投影，`domain` 等新字段只在这里。
     */
    uiMetadata?: Record<string, unknown>;
    /** 工具入参（AppRenderer.toolInput） */
    toolInput?: Record<string, unknown>;
    /**
     * MCP CallToolResult。兼容历史上只携带 structuredContent 的部分载荷，
     * 具体字段由消费侧做运行时校验。
     */
    toolResult?: Record<string, unknown>;
}
/**
 * 一次 startBroadcasting 的唯一凭证（方案 §三.3）。
 *
 * 不同发起方（TUI / 多个 ACP 连接）对同一 session 的 excludeConnectionId 不同，
 * 简单 refcount 无法区分谁的广播还活着。lease 让 stopBroadcasting(session, lease)
 * 只停止当前 lease 对应的订阅，防止旧 turn 的 finally 把新 turn 的广播关掉。
 */
export interface BroadcastLease {
    readonly session: Session;
    readonly generation: number;
}
/**
 * ACP 广播服务接口
 *
 * 将 session 事件广播到所有已连接的 ACP 客户端（除了发起该事件的连接）。
 * 用于实现多页面实时同步 —— 当一个 Web UI 页面发送 prompt 时，
 * 其他页面也能实时看到 agent 的输出。
 */
export interface AcpBroadcastService {
    /**
     * 开始广播 session 事件到其他连接
     * 订阅 session.combineSubject，将事件转发到除 excludeConnectionId 外的所有连接
     *
     * @param session 当前 session
     * @param excludeConnectionId 发起 prompt 的连接 ID（不广播给自己）
     * @param tracking 可选的请求追踪信息（requestId/messageId）
     * @returns 本次广播的 lease/token；stopBroadcasting(session, lease) 只允许
     *          当前 lease 停止自己的订阅，防止旧 turn 的 finally 关闭新 turn 的广播。
     */
    startBroadcasting(session: Session, excludeConnectionId: string, tracking?: AcpRequestTracking): BroadcastLease;
    /**
     * 是否已有活跃广播（ACP prompt / TUI send 已经 startBroadcasting）。
     * 收件箱直跑 agentService.run 时用这个判断，避免把 prompt 那轮的 lease 顶掉。
     */
    hasActiveBroadcast(session: Session): boolean;
    /**
     * 广播用户消息到其他连接
     * 在 prompt 执行前调用，让其他页面看到用户的输入
     *
     * @param sessionId session ID
     * @param text 用户消息文本
     * @param excludeConnectionId 发起 prompt 的连接 ID
     * @param images 可选的图片元信息（blob path + mimeType）
     * @param clientMeta 客户端不透明 metadata。steer 注入回执通过固定 ACP envelope 携带；
     *   是否产生回执及其消息 id 由独立的 clientUserMessageId 决定，agent-cli 不展开、
     *   不解读 metadata 内部字段。
     */
    broadcastUserMessage(sessionId: string, text: string, excludeConnectionId: string, images?: Array<{
        blobPath: string;
        mimeType: string;
    }>, tracking?: AcpRequestTracking, session?: Session, timestamp?: number, clientMeta?: unknown): Promise<void>;
    /**
     * 广播 session 结束事件到其他连接
     * 在 prompt 完成后调用，让其他页面知道流式输出已结束
     *
     * @param sessionId session ID
     * @param excludeConnectionId 发起 prompt 的连接 ID
     * @param session 可选运行时 session；传入后广播前会确认 session 仍然真正空闲，
     *                避免 compact/auto-continue 中间态泄漏 session_end
     */
    broadcastSessionEnd(sessionId: string, excludeConnectionId: string, session?: Session, timestamp?: number, stopReason?: 'end_turn' | 'cancelled' | 'refusal', requestId?: string): Promise<void>;
    /**
     * 广播 checkpoint 通知到所有连接
     * 在 checkpoint 创建/更新/回退后调用，让客户端更新文件变更视图
     *
     * @param sessionId session ID
     * @param event 事件类型
     * @param checkpointInfo 客户端可见的 checkpoint 信息
     */
    broadcastCheckpoint(sessionId: string, event: CheckpointBroadcastEvent, checkpointInfo: CheckpointBroadcastInfo): Promise<void>;
    /**
     * 当前 session 是否存在需要详细 checkpoint（per-file diff/stats）的客户端。
     * 用于决定是否生成高成本的详细 diff 数据。
     */
    hasDetailedCheckpointConsumer(sessionId: string): boolean;
    /**
     * 停止广播
     * 取消订阅 session.combineSubject
     *
     * Runtime callers pass the exact Session object. The string arm is a
     * single-Owner Host compatibility seam only.
     *
     * @param lease 可选：只允许该 lease 对应的订阅被停止。多发起方（TUI / 多个
     *              ACP 连接）对同一 session 的 excludeConnectionId 不同，简单
     *              refcount 无法区分——lease 保证旧 turn 的收尾不会误关新 turn。
     */
    stopBroadcasting(session: Session | string, lease?: BroadcastLease): void;
    /**
     * 广播一个显式 interruption 请求到所有 ACP 连接。
     * 使用 session_info_update + _meta，不依赖 requestPermission RPC。
     *
     * @param approvalSession 审批所属 session；ExitPlanMode 用它读计划展示给弹窗（#82046）。
     */
    broadcastInterruptionRequest(sessionId: string, item: RunToolApprovalItem, approvalSession?: Session): Promise<void>;
    /**
     * 广播 interruption 已被解决。
     */
    broadcastPermissionResolved(sessionId: string, toolCallId: string, toolName: string, decision: PermissionDecision): Promise<void>;
    /**
     * 广播 MCP 工具的流式进度通知到所有 ACP 连接。
     *
     * 当 MCP server 通过 `notifications/progress` 发送进度时，
     * CLI 把进度封进 ACP `tool_call_update._meta['codebuddy.ai'].toolMetaData.mcpProgress`，
     * desktop / web UI 的 MessageConverter 会把它还原成 `tool.metaData.mcpProgress`，
     * MCP tool renderer 在 `isToolRunning` 期间显示 `progress/total - message`。
     *
     * 设计说明：
     * - 不带 `status` —— 仅增量更新 metaData，避免与 agent 主流程的 status 流抢话语权。
     * - 走 `tool_call_update`（而非 `session_info_update`），让 desktop adapter 现有的
     *   `tool.metaData` 合并机制（workbuddy-agent-adapter-next.ts ~line 4010）自动接管。
     */
    broadcastMcpProgress(sessionId: string, toolCallId: string, toolName: string, progress: {
        progress: number;
        total?: number;
        message?: string;
    }): Promise<void>;
    broadcastSecurityConclusions(sessionId: string, toolCallId: string, toolName: string, conclusions: SecurityReviewConclusion[]): Promise<void>;
    broadcastSensitiveUserProtectionNotice(sessionId: string, conversationRequestId: string, entryCount: number): Promise<void>;
    /**
     * 广播 MCP Apps（`io.modelcontextprotocol/ui`）UI 渲染载荷到所有 ACP 连接。
     *
     * 当一个声明了 `_meta.ui.resourceUri` 的 MCP 工具调用完成、且 host 已取回
     * UI 资源 HTML 时，把渲染所需数据封进
     * `tool_call_update._meta['codebuddy.ai'].toolMetaData.mcpUi`（与 `mcpProgress`
     * 同构），Web UI 的 MessageConverter 还原成 `tool.metaData.mcpUi` 后，喂给
     * `@mcp-ui/client` 的 `AppRenderer` 在沙箱 iframe 中渲染。
     *
     * 载荷形状对齐 `AppRenderer` props：`toolResourceUri` / `html` / `mimeType` /
     * `csp` / `permissions` / `prefersBorder` / `toolInput` / `toolResult`。
     * `html` 超阈值（默认 256KB）时省略，由 Web UI 经 `onReadResource` 回拉。
     *
     * 不带 `status` —— 仅增量带 metaData，避免与 agent 主流程 status 抢话语权。
     */
    broadcastMcpUi(sessionId: string, toolCallId: string, toolName: string, mcpUi: McpUiBroadcastPayload): Promise<void>;
    /**
     * 在 prompt 异常终止（如 idle timeout）时，对指定 session 上所有仍处于非终态
     * 的 toolCallId 广播 tool_call_update { status: 'failed' }，让所有订阅者
     * 都能把 pending 卡片收尾。
     *
     * 幂等：对同一 sessionId 重复调用不会触发重复广播（内部维护 sent set）。
     * 同一 sessionId 上启动新一轮 broadcasting（即下一次 prompt）时，
     * 内部会自动清除该 sessionId 的幂等标记，无需调用方操心。
     *
     * @param sessionId 要收口的 session
     * @param reason 展示给用户的文本（写入 content[0].content.text）
     * @param terminationReason 可选的机器可读终止原因；调用方必须传真实原因，
     *   不能把普通 cancel 标记为 prompt_timeout。
     */
    broadcastToolCallFailedForSession(sessionId: string, reason: string, terminationReason?: string): Promise<void>;
    /**
     * 广播"最后一次压缩被用户取消"信号到所有已连接的 ACP client，让 UI 三端
     * （desktop CompactDivider / agent-cli web-ui CompactGroupItem / cb-chat-ui）
     * 区分"已完成 ✓"vs"已取消"——覆盖纯内容判据 (`<summary>` 闭合标签) 误判。
     *
     * Why broadcast 而非依赖后续 sessionUpdate:
     *   compact agent 已 stream 出的 chunks 留在 desktop messageCache。session 历史不可变,
     *   失败/取消的 compact 消息会持久化在 jsonl 里(view 层 getCompactHistory /
     *   replaceCompactWithSummary 会按"提不到 <summary> 即视作失败"自动忽略)。
     *   adapter 的 `isCompactSummaryComplete()` 用纯内容判据看到 messageCache 里那条还有
     *   闭合 `<summary>` 标签 → 误判 completed。必须有独立信号 override。
     *
     * 信号格式: session_info_update._meta['codebuddy.ai/compact-cancelled'] = { cancelled: true }。
     *
     * @param sessionId session ID
     */
    broadcastCompactCancelled(sessionId: string): Promise<void>;
    /**
     * 广播"压缩开始"信号到所有已连接的 ACP client。
     *
     * 用于 doMaxTokenCompaction 场景：该路径使用 runOneTime 静默执行 summary agent，
     * 不产出流式 agent_message_chunk，因此 adapter 的 processAccumulatedUpdate 无法
     * 自动生成 CompactDivider shimmer。本方法手动广播一条带 isCompactInternal meta 的
     * agent_message_chunk（内容不含闭合的 <summary> 标签），让 adapter 生成
     * compactStatus='compacting' 的 CompactDivider（shimmer 动画"正在压缩上下文"）。
     *
     * 调用方需保存返回的 messageId，后续传给 broadcastCompactCompleted 以确保
     * adapter 使用同一 messageId 做 shimmer → completed 的覆盖翻转。
     *
     * @param sessionId session ID
     * @param compactType 可选压缩类型（`pre-message-auto` / `emergency-auto` / `user-command`）。
     *                    透传到 `_meta['codebuddy.ai/compactType']`，desktop adapter 据此决定
     *                    是否给 divider 打 `hideAdjacentAssistantDecorations` 标记
     *                    （仅自动压缩类型打标，手动 `/compact` 不打）。
     * @param session 可选 session 引用：传入时 broadcast 会在 `_meta` 中带上
     *                `codebuddy.ai/isSubAgent` 和 `codebuddy.ai/parentSessionId`，
     *                desktop adapter 据此过滤 sub-agent compact transcript（issue #44075）。
     *                不传时保持原有行为，向后兼容。
     * @returns 生成的 messageId，供后续 broadcastCompactCompleted 使用
     */
    broadcastCompactStarted(sessionId: string, compactType?: string, session?: Session): Promise<string>;
    /**
     * 广播"压缩已完成"信号到所有已连接的 ACP client。
     *
     * 必须与 broadcastCompactStarted 配对使用，传入相同的 messageId，
     * 让 adapter 的 processAccumulatedUpdate 使用同一 messageId 从
     * compactStatus='compacting' (shimmer) 翻转到 compactStatus='completed' (静态)。
     *
     * 信号格式: agent_message_chunk + _meta['codebuddy.ai/isCompactInternal']=true
     *           + content 包含已闭合的 <conversation_history_summary><summary>...</summary></conversation_history_summary>
     *
     * @param sessionId session ID
     * @param summaryText 压缩后的摘要文本
     * @param messageId 由 broadcastCompactStarted 返回的 messageId
     * @param compactType 可选压缩类型，必须与 broadcastCompactStarted 传入值一致；
     *                    completed 帧也需透传以保证 adapter 翻转时 divider 仍能拿到该标记。
     * @param session 可选 session 引用：传入时 broadcast 会在 `_meta` 中带上
     *                `codebuddy.ai/isSubAgent` 和 `codebuddy.ai/parentSessionId`，
     *                desktop adapter 据此过滤 sub-agent compact transcript（issue #44075）。
     */
    broadcastCompactCompleted(sessionId: string, summaryText: string, messageId: string, compactType?: string, session?: Session): Promise<void>;
    /**
     * 广播"compact 次数达到上限"信号到所有已连接的 ACP client。
     *
     * 当单次 request 内 EMERGENCY_AUTO compact 连续触发超过阈值（默认 5 次），
     * 通知 UI 展示警告提示。此时主 agent 将停止当前 request，不再 sendContinueMessage。
     *
     * 信号格式: session_info_update._meta['codebuddy.ai/compact-limit-reached'] = { limitReached: true }。
     *
     * @param sessionId session ID
     */
    broadcastCompactLimitReached(sessionId: string): Promise<void>;
    /**
     * 广播消息队列更新到所有连接
     * 在 sendNow 项被消费后调用，通知 UI 更新队列状态
     *
     * @param sessionId session ID
     * @param queueData 更新后的队列快照
     */
    broadcastMessageQueueUpdate(sessionId: string, queueData: Record<string, unknown>): Promise<void>;
    /**
     * Web UI Mode A 跟进队列快照。`session_info_update._meta['codebuddy.ai/followupQueue']`。
     * 不复用 Mode B 的 `message_queue_update`，避免 WorkBuddy rich queue 误读。
     */
    broadcastFollowupQueue(sessionId: string, queueData: Record<string, unknown>): Promise<void>;
    /**
     * 广播 `/goal` 无参请求的 recap 数据到所有已连接的 ACP client。
     *
     * GoalCommandExecutor 在 `/goal`（无参）时调用：TUI 客户端通过本地
     * NavigationManager 切到 `/chat/panel/goal`；Web UI / 其他 ACP 客户端则
     * 凭这条广播消息打开自己的 recap 浮层（modal）。
     *
     * 信号格式: session_info_update._meta['codebuddy.ai/goalRecap'] = {
     *   active?:  { condition },                       // 当前 active goal
     *   latest?:  { ok, reason?, condition,            // 最近一次终态（无 active 时携带）
     *               durationMs, turnCount, tokenDelta },
     *   // active 与 latest 都缺省时表示"从未设过 goal"，UI 显示引导文案。
     * }
     *
     * @param sessionId session ID
     * @param recap recap 数据快照（由 GoalService 当场组装）
     */
    broadcastGoalRecap(sessionId: string, recap: GoalRecapPayload): Promise<void>;
    /**
     * 把一条 goal history item（goalStatus / goal-progress / goal-result）推给所有 ACP 连接。
     * slash `/goal` 走 combineSubject；HTTP PUT/DELETE 和 idle 连接没有 forwarding，必须走这里。
     */
    broadcastGoalHistoryItem(sessionId: string, item: unknown): Promise<void>;
    /**
     * 推送当前 busy + activeGoal 快照。Web UI 用它对齐目标条、暂停按钮和左侧转圈。
     */
    broadcastSessionSnapshot(sessionId: string, snapshot: {
        busy: boolean;
        activeGoal: {
            condition: string;
            createdAt: number;
            paused?: boolean;
            pausedAt?: number;
        } | null;
    }): Promise<void>;
    /**
     * 广播一条【实时】会话标题更新到所有 ACP 连接。
     *
     * 与 replay 期间的 title 推送（session-replay.ts，带 `codebuddy.ai.mode='history'`
     * 只读标记）不同：这条是 live 更新，**不带** history 标记，因此 daemon 的
     * handleBackendSessionUpdate 会把它写回 DB.title。
     *
     * 用途：AI 标题（ai-title）异步生成完成后（SessionTitleService.persistTitle），
     * prompt 尾部的 sendPendingTitleUpdate 可能因 5s 超时已推了首条消息的 fallback 标题
     * 并落库，导致 DB.title 与 JSONL 的 ai-title 分叉。生成完成时补推一条 live 标题，让
     * DB 与 JSONL 从源头对齐，根治"打开历史任务标题变化"（详见
     * scripts/reproduce/loadsession-replay-rewrites-title）。
     *
     * @param sessionId session ID
     * @param title 已持久化到 JSONL 的会话标题
     */
    broadcastSessionTitle(sessionId: string, title: string): Promise<void>;
    /**
     * 广播首轮 MCP prewait 连接状态到所有 ACP 连接。
     *
     * 数据来源与 TUI 顶部 `McpStartupBanner`、stdio stream-json `mcp_status`
     * 完全一致——都是 `McpFirstRunStatusService.events$`（进程级Singleton，由
     * `AgentManager.runFirstSessionMcpPrewait` 在首个 prompt 的 prewait 期间
     * emit `start` / `server` / `finish`）。ACP 客户端（IDE / Web UI）走
     * `session/new` + 首个 `session/prompt` 时即可实时同步"哪些 MCP 正在连接 /
     * 已就绪 / 失败 / 超时"，语义对齐 stdio 常驻模式（整体等待、不打断）。
     *
     * 合规：不新增 sessionUpdate 类型，走 `session_info_update` + 扁平
     * `_meta['codebuddy.ai/mcpFirstRunStatus']`（与 goalRecap /
     * message_queue_update 同款）。payload 复用 stream-json 的 snake_case 字段，
     * 让两条链路的接入方拿到同构数据。
     *
     * @param sessionId session ID
     * @param event 首轮状态事件（start / server / finish）
     */
    broadcastMcpFirstRunStatus(sessionId: string, event: McpFirstRunStatusEvent): Promise<void>;
    /**
     * 把某个会话最新的 configOptions 推送给正在看它的 Web UI 连接。
     *
     * 场景：TUI / REPL 侧的配置变更（如 `/effort` 改 thought_level）只写会话级
     * override，不经过 ACP `setSessionConfigOption`，因此不会触发
     * `configChangeEvent`；而 Web UI 的配置选择器只在会话建立和该事件里回填，
     * 会一直停在会话开始时的旧值（表现为"CLI 里改了档位，Web UI 还是默认值"）。
     *
     * 由非 ACP 来源的配置写入方在改完之后调用。没有 Web UI 连接 / 没有连接在看
     * 该会话时是 no-op。
     */
    broadcastConfigOptions(sessionId: string): Promise<void>;
    /**
     * 清理所有广播订阅
     */
    dispose(): void;
}
/**
 * `/goal` recap 广播 payload。
 *
 * 与 GoalRecapPanel（TUI）三态保持一一对应：
 *   - active 有值      → 渲染 "Goal active: <condition>"
 *   - active 缺省 + latest 有值 → 渲染 ✔/✕ + stats + Goal: + reason
 *   - 两者都缺省       → 渲染 "No goal set yet" 引导
 *
 * 字段结构与 GoalResultItem / ActiveGoal 拆出"UI 必需子集"，避免泄露内部
 * scopeId / createdAt 等实现细节给前端。
 */
export interface GoalRecapPayload {
    /**
     * 本次 recap 的生成时间：宿主用它区分「新一次查询」与「同一条重复下发」
     * （关掉后同一次不再弹；再问一次 /goal 会拿到新的 at，应该重新弹）。
     */
    at?: number;
    /**
     * 进行中目标的状态：除条件 / 暂停态外，带上无参 /goal 要展示的详细项
     * （运行时长 / 评估 turn 数 / Token 消耗 / 最近一次评估原因）。
     */
    active?: {
        condition: string;
        paused?: boolean;
        /** 已运行时长（暂停态冻在 pausedAt）。 */
        durationMs?: number;
        /** 已评估轮次（Stop hook 评估次数）。 */
        turnCount?: number;
        /** 目标期间累计消耗的 token（当前会话用量 - 目标起点用量）。 */
        tokenDelta?: number;
        /** 最近一次 Stop hook 的评估原因（goal-progress 项的 reason）。 */
        reason?: string;
    };
    latest?: {
        ok: boolean;
        reason?: string;
        condition: string;
        durationMs: number;
        turnCount: number;
        tokenDelta: number;
    };
}
/**
 * ACP 连接守卫接口。
 * 负责 session token 管理和连接数限制。
 */
export interface AcpConnectionGuard {
    /**
     * 初始化配置（从 SettingsManager 和环境变量读取）。
     * 应在 ServerModeStrategy 中与其他服务的 setup() 一起调用。
     */
    setup(): Promise<void>;
    /**
     * 为新连接颁发 session token。
     * @returns token 字符串，或 undefined 如果超过连接数限制
     */
    issueToken(connectionId: string, options?: {
        webUi?: boolean;
    }): string | undefined;
    /**
     * 验证请求中的 session token。
     * @param token 请求携带的 token
     * @returns 关联的 connectionId，或 undefined 如果无效/过期
     */
    validateToken(token: string): string | undefined;
    /** Whether the connection was granted the trusted WebUI transport capability. */
    isWebUiConnection(connectionId: string): boolean;
    /**
     * 吊销 token（连接关闭时调用）。
     */
    revokeToken(connectionId: string): void;
    /**
     * 获取当前活跃连接数。
     */
    getActiveConnectionCount(): number;
    /**
     * 获取最大允许连接数。
     */
    getMaxConnections(): number;
}
/**
 * 用户信息
 */
export interface UserInfoData {
    userId: string;
    userName: string;
    userNickname: string;
    enterpriseId?: string;
    enterpriseName?: string;
    enterprise?: string;
    authType?: string;
    /** 用户真实头像 URL，后端不保证有值 */
    avatarUrl?: string;
    /** 访问令牌 */
    token?: string;
    /** 访问令牌（别名） */
    accessToken?: string;
}
/**
 * getUserInfo 响应
 */
export interface GetUserInfoResponse {
    userInfo?: UserInfoData;
}
export type { InitializeRequest, InitializeResponse, AuthenticateRequest, AuthenticateResponse, NewSessionRequest, NewSessionResponse, LoadSessionRequest, LoadSessionResponse, PromptRequest, PromptResponse, CancelNotification, SetSessionModelRequest, SetSessionModelResponse, SetSessionModeRequest, SetSessionModeResponse, ClientCapabilities, TerminalHandle, TerminalOutputResponse, AgentSideConnection, RequestError, };
export type { SetSessionConfigOptionRequest, SetSessionConfigOptionResponse, SessionConfigOption, };
export type { ContentBlock as AcpContentBlock, McpServer, ToolCallContent, ToolCallLocation, ToolKind, SessionNotification, PermissionOption, PlanEntry, ReadTextFileRequest, ReadTextFileResponse, WriteTextFileRequest, WriteTextFileResponse, AvailableCommand, ModelInfo, };
export type AcpTransportType = 'stdio' | 'streamable-http';
export interface AcpServerStartOptions {
    /**
     * Explicit transport for `--serve` / daemon / ServerAware.
     * `--acp-transport` commander 默认值是 `stdio`，未传 `--acp` 时不得覆盖这里。
     */
    transport?: AcpTransportType;
    /**
     * CLI options from cli.opts()
     */
    cliOptions?: CommonRequest;
}
/**
 * `--acp-transport` 在 commander 里缺省就是 `stdio`，即使没传 `--acp`。
 * `--serve` 会把整份 opts 塞进 start()；若无条件优先 cliOptions.acpTransport，
 * 会误开 stdio-main，把 session/update 打到进程 stdout。
 *
 * `--acp` 才认 CLI transport；否则认显式 `transport`（serve / daemon / HTTP 就绪回调）。
 */
export declare function resolveAcpStartTransport(options?: AcpServerStartOptions): AcpTransportType;
export interface AcpServer {
    start(options?: AcpServerStartOptions): Promise<void>;
    stop(): Promise<void>;
    isRunning(): boolean;
}
/**
 * Request handler function type for ACP agent prompts.
 * Encapsulates the HTTP request logic to /agent endpoint.
 *
 * @param sessionId - The session ID to use
 * @param messages - The AgentInputItem[] messages to send
 * @param headers - Optional headers to include in the request
 */
export type AcpRequestHandler = (acpPrompt: PromptRequest) => Promise<void>;
export interface PendingToolCall {
    toolCallId: string;
    toolName?: string;
    memberEvent?: string;
}
export interface AcpAgent extends Agent {
    /**
     * Set the ACP connection instance
     * Called by AcpServer after connection is created
     * @param connection - The AgentSideConnection instance
     * @param connectionId - Optional connection ID for tracking
     */
    setConnection(connection: AgentSideConnection, connectionId?: string): void;
    /** Release subscriptions and timers owned by this ACP connection. Idempotent. */
    dispose(): void;
    /**
     * Get the connection ID
     */
    getConnectionId(): string | undefined;
    /**
     * Get the connection instance (for AcpView to use)
     */
    getConnection(): AgentSideConnection;
    /** Whether this physical ACP connection completed the Web UI handshake. */
    isWebUiClient?(): boolean;
    /**
     * Returns a connection fenced by the current authenticated runtime
     * attachment. Broadcast-only callers must use this instead of the naked
     * connection so the receiver can validate Owner/session authority.
     */
    tryGetAuthorizedConnection(): AgentSideConnection | undefined;
    /**
     * 该连接是否正处于「历史回放窗口」中（session/load 或 session/new+continue 的
     * 回放尚未 settle）。窗口内广播的 user 消息必须经 queueReplayDeferredSessionUpdate
     * 排队，回放结束后统一 flush（快照已含的跳过），避免同一条消息双投递。
     */
    isReplayWindowActive(): boolean;
    /**
     * 回放窗口内，把一条 user 消息广播暂存起来。窗口结束（回放 settle）后统一处理：
     * 回放快照已含该消息 → 丢弃（回放已投）；快照没有 → 补投。
     */
    queueReplayDeferredSessionUpdate(notification: {
        sessionId: string;
        update: unknown;
    }): void;
    /**
     * Prompt 事件 Subject - AcpView 订阅此事件
     */
    readonly promptEvent: Subject<AcpPromptItem>;
    /**
     * Model 变更事件 Subject - AcpView 订阅后修改 session
     */
    readonly modelChangeEvent: Subject<AcpModelChangeEvent>;
    /**
     * Mode 变更事件 Subject - AcpView 订阅后修改 session
     */
    readonly modeChangeEvent: Subject<AcpModeChangeEvent>;
    /**
     * Config 变更事件 Subject - AcpView 订阅后修改 settings
     */
    readonly configChangeEvent: Subject<AcpConfigChangeEvent>;
    /**
     * Cancel 事件 Subject - AcpView 订阅后调用 session.abort
     */
    readonly cancelEvent: Subject<AcpCancelEvent>;
    /**
     * Consume the pending cancellation marker for a session.
     * AcpView uses this when an ACP client sends a no-op cancel while the session is idle.
     */
    consumePendingCancellation(sessionId: string): boolean;
    /**
     * Get the pending session request info
     * Used by AcpView to determine if this is a new session or load session request
     */
    getSessionRequest(): AcpSessionRequest | undefined;
    /**
     * Create a promise that forwards session events to ACP client
     * Called by AcpView during prompt execution
     * @param session - The session to subscribe to
     * @returns Promise that resolves with stop reason, optional error message, and original finish_reason when session completes
     */
    createEventForwardingPromise(session: Session, tracking?: AcpRequestTracking, options?: AcpForwardingOptions): Promise<{
        stopReason: StopReason;
        errorMessage?: string;
        finishReason?: string;
        traceId?: string;
    }>;
    /**
     * Handle tool approval request - sends permission request to client
     * Called by AcpView when tool approval is needed
     */
    handleToolApproval(approval: RunToolApprovalItem, sessionId: string, sourceSessionId?: string): Promise<void>;
    /**
     * Set the session instance
     * Called by AcpView after session is created/loaded via /agent endpoint
     * This resolves the sessionDeferred that newSession/loadSession is waiting on
     * @param session - The session instance
     */
    setSession(session: Session): void;
    initialize(request: InitializeRequest): Promise<InitializeResponse>;
    authenticate(request: AuthenticateRequest): Promise<AuthenticateResponse>;
    getUserInfo(): Promise<GetUserInfoResponse>;
    newSession(request: NewSessionRequest): Promise<NewSessionResponse>;
    loadSession(request: LoadSessionRequest): Promise<LoadSessionResponse>;
    unstable_resumeSession(request: ResumeSessionRequest): Promise<ResumeSessionResponse>;
    prompt(request: PromptRequest): Promise<PromptResponse>;
    cancel(params: CancelNotification): Promise<void>;
    setSessionModel(params: SetSessionModelRequest): Promise<SetSessionModelResponse | void>;
    unstable_setSessionModel(params: SetSessionModelRequest): Promise<SetSessionModelResponse | void>;
    setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse>;
    /**
     * Get the full list of config options for a session.
     * Used by AcpView to build config_option_update notifications.
     */
    getConfigOptions(session: Session): Promise<SessionConfigOption[]>;
    /**
     * Rebuild 后把当前可用模型目录推给 CLI Web UI（仅 model_update）。
     * 目录未变化或连接不是 Web UI 时是 no-op。
     */
    pushAvailableModelsUpdate?(session: Session): Promise<void>;
    /**
     * Get the client capabilities
     * Returns the capabilities received during initialize()
     */
    getClientCapabilities(): ClientCapabilities | undefined;
    /**
     * Get the current bound session id for this connection.
     * Returns undefined before setSession() binds the connection to a session.
     */
    getCurrentSessionId(): string | undefined;
    /** Page extension control context, without a Chat writer or selected-session binding. */
    getModPageSessionId?(): string | undefined;
    getModPageSession?(): Session | undefined;
    /**
     * Get the live Session instance currently bound to this connection.
     * Unlike SessionManager.get(), this never reloads a second instance from persistence.
     */
    getCurrentSession(): Session | undefined;
    /**
     * 返回当前连接上、尚未收到终态 tool_call_update 的 toolCallId 列表。
     *
     * 仅在 agent 绑定的 session 与入参 sessionId 一致时才返回非空数组，
     * 否则返回空数组。由 AcpBroadcastService.broadcastToolCallFailedForSession
     * 在 prompt idle timeout 收尾时调用。
     *
     * 只读能力：不修改 agent 内部状态，不发送任何事件。
     *
     * @param sessionId 目标 session
     */
    listPendingToolCallIds(sessionId: string): string[];
    /**
     * 返回当前连接上、尚未收终态的 toolCall 列表（含工具名）。
     *
     * 与 listPendingToolCallIds 同源，额外带上工具名。供
     * AcpBroadcastService.broadcastToolCallFailedForSession 在 reclaim 收尾时
     * 跳过交互类问题工具（AskUserQuestion 等）——它们的 pending 是"等用户回答"
     * 的合法长态，不应被 prompt_timeout 广播冲成 failed。
     *
     * 只读能力：不修改 agent 内部状态，不发送任何事件。
     *
     * @param sessionId 目标 session
     */
    listPendingToolCalls(sessionId: string): PendingToolCall[];
    /**
     * 通知 ACP Agent 一个 `tool_call` sessionUpdate 已经被外部发布者
     * （如 AcpTeamBridge 转发 team member、coordinator ACP 桥转发 detached worker）发出。
     *
     * Why: `handleToolApproval` 内部 await 在
     * `toolCallSentDeferreds.get(toolCallId).promise` 上，确保
     * `requestPermission` RPC 一定在对应 `tool_call` sessionUpdate 之后送达。
     * 主 session combineSubject 的 handler 内部已自处理 deferred set+resolve；
     * 但 team member / coordinator detached worker 的 `tool_call` 由外部桥转发，
     * bridge 不持有 deferred map，所以需要这个对外接口去 unblock。
     *
     * 幂等：deferred 不存在则创建并立即 resolve；已存在则直接 resolve。
     *
     * @param toolCallId 已发出 tool_call 的 toolCallId
     * @param toolName 可选，该 tool_call 的工具名（title / _meta['codebuddy.ai/toolName']）。
     *   透传后 agent 会记入 toolCallNameById，使 AcpBroadcastService 在 reclaim 收尾时能按
     *   isInteractiveQuestionTool 跳过交互类问题工具（含 MCP 全限定名）。外部发布者（如
     *   AcpTeamBridge 转发 team member tool_call）应尽量透传，否则 member 的 AskUserQuestion /
     *   pick_location 会被 reclaim 误判 failed。
     * @param memberEvent 可选，该 tool_call 归属的 team member 名。对应
     *   `_meta['codebuddy.ai/memberEvent']`，供后续终态收口保留原路由。
     */
    notifyToolCallSent(toolCallId: string, toolName?: string, memberEvent?: string): void;
    /**
     * 通知 ACP Agent 一个外部发布者已发出 `tool_call_update`。
     *
     * 只有 ACP 终态 `completed` / `failed` 会结束 pending 生命周期；
     * `pending` / `in_progress` / 缺失 status 都是增量更新，不得提前清理。
     * 终态仅删除 pending 元数据，不能 resolve 等待 `tool_call` 发送的
     * deferred，否则启动帧发送失败时 permission RPC 会越过工具卡。
     * 重复通知安全无害。
     */
    notifyToolCallUpdateSent(toolCallId: string, status?: ToolCallStatus): void;
}
/**
 * Prompt 事件项，用于 AcpAgent 和 AcpView 之间通信
 */
export interface AcpRequestTracking {
    requestId: string;
    messageRequestId?: string;
    /** Actual admitted user entry ID, distinct from optimistic request correlation. */
    userEntryId?: string;
    conversationRequestIdCandidate?: string;
    conversationRequestId?: string;
}
export interface AcpPromptItem {
    /** Host-validated mod receipt; never copied from client metadata. */
    modsPromptSubmitted?: true;
    request: PromptRequest;
    responseDeferred: Deferred<PromptResponse>;
    tracking: AcpRequestTracking;
    /**
     * 内部 drain 触发标记。当后台任务完成时，BackgroundTaskNotifierImpl 通过
     * AcpDrainTrigger 推入一条 isDrain=true 的 item，AcpView 的 for-await 循环
     * 识别后直接走 drainQueuedMessages 路径（带事件转发），不走 executePrompt。
     */
    isDrain?: boolean;
    /** WebUI 跟进队列唤醒，仍逐轮消费，不按后台通知整批合并。 */
    isFollowupDrain?: true;
}
export interface AcpForwardingOptions {
    signal?: AbortSignal;
}
/**
 * Model 变更事件
 */
export interface AcpModelChangeEvent {
    sessionId: string;
    modelId: string;
}
/**
 * Mode 变更事件
 */
export interface AcpModeChangeEvent {
    sessionId: string;
    modeId: PermissionMode;
}
/**
 * Config 变更事件
 * 用于 AcpAgent 向 AcpView 传递配置变更
 */
export interface AcpConfigChangeEvent {
    sessionId: string;
    configId: string;
    value: string | boolean;
}
export { ACP_CANCEL_REASON_COMPACT_LIMIT_REACHED, ACP_CANCEL_REASON_SANDBOX_APPROVAL_TIMEOUT, ACP_CANCEL_REASON_TOOL_CALL_LOOP_STOPPED, ACP_META_CANCEL_REASON, } from '../../vendor/cbc-shared/node/index.js';
/** `codebuddy.ai/interceptType` 取值：疑似工具调用循环，请用户决定继续还是停止。 */
export declare const TOOL_CALL_LOOP_INTERCEPT_TYPE: "tool-call-loop";
export declare const ACP_META_SENSITIVE_INPUT_DECISION: "codebuddy.ai/sensitiveInputDecision";
/**
 * `_codebuddy.ai/goalControl` 扩展方法名（宿主目标控制通道）。
 *
 * 必须与 workbuddy-core 的 `ConversationAcpMethod.GoalControl` 完全一致。
 *
 * 常量放在协议面而不是 acp-goal-control（控制实现）里：acp-stream-manager 只需要这个
 * 字符串来判定 unary JSON 交付，若从实现文件取，冷启动链就会静态挂上整个控制实现
 * （GoalService / broadcast / SDK 面），实现里任何新 import 都会静默落到 standby
 * 冷启动路径上 —— bundle-lite-wb-prewarm-memory 卡点就是这么被顶穿的。
 */
export declare const GOAL_CONTROL_METHOD: "_codebuddy.ai/goalControl";
/**
 * Cancel 事件
 * 用于 AcpAgent 向 AcpView 传递取消指令
 */
export interface AcpCancelEvent {
    sessionId: string;
    /** CLI-internal cancel reason used by UI to distinguish user cancel vs automatic timeout. */
    cancelReason?: string;
}
/**
 * Session 请求类型
 */
export type AcpSessionRequestType = 'new' | 'load' | 'resume';
/**
 * Session 请求信息
 * 用于 newSession/loadSession 发起请求时携带信息给 AcpView
 * MCP 配置通过请求 body 的 mcpConfig 字段传递给 mcp-validate-middleware 处理
 */
export interface AcpSessionRequest {
    type: AcpSessionRequestType;
    sessionId?: string;
}
/**
 * Transport 创建事件
 */
export interface AcpTransportCreatedEvent {
    connectionId: string;
    transport: AcpTransport;
}
/**
 * ACP Transport 接口（Request scope）
 */
export interface AcpTransport {
    /**
     * 初始化 transport
     */
    init(): void;
    /**
     * 设置 stream
     */
    setStream(stream: Stream): void;
    /**
     * 获取 stream
     */
    readonly stream: Stream;
    /**
     * 关闭 transport
     */
    close(): Promise<void>;
}
/**
 * ACP Transport Factory 接口
 */
export interface AcpTransportFactory {
    /**
     * 创建新的 transport
     * @param connectionId 连接 ID
     * @param type transport 类型
     */
    create(connectionId: string, type: AcpTransportType): Promise<AcpTransport>;
}
/**
 * ACP Transport Manager 接口
 */
export interface AcpTransportManager {
    /**
     * 创建新的 transport
     * @param connectionId 连接 ID
     * @param type transport 类型
     */
    create(connectionId: string, type: AcpTransportType): Promise<AcpTransport>;
    /**
     * 获取已存在的 transport
     */
    get(connectionId: string): AcpTransport | undefined;
    /**
     * 关闭并清理 transport
     */
    close(connectionId: string): Promise<void>;
    /**
     * transport 创建事件 Subject
     */
    readonly transportCreated: Subject<AcpTransportCreatedEvent>;
}
/**
 * HTTP 连接状态（用于 streamable-http 模式）
 */
export interface AcpHttpConnectionState {
    standaloneSse?: ServerResponse;
    /** 本段 GET SSE 断开期内是否已告警过通知丢弃；重新挂上 SSE 时复位。 */
    standaloneSseClosedWarned?: boolean;
    initialized: boolean;
    inFlightPrompts: Set<string>;
    streamMapping: Map<string, ServerResponse>;
    requestToStreamMapping: Map<string | number, string>;
    requestResponseMap: Map<string | number, unknown>;
    incomingController?: ReadableStreamDefaultController<unknown>;
}
/**
 * ACP Stream Manager 接口
 */
export interface AcpStreamManager {
    /**
     * 创建 stream
     * @param connectionId 连接 ID
     * @param type stream 类型
     */
    create(connectionId: string, type: AcpTransportType): Stream;
    /**
     * 获取 stream
     */
    get(connectionId: string): Stream | undefined;
    /**
     * 关闭 stream
     */
    close(connectionId: string): void;
    /**
     * 处理 HTTP 请求（仅 streamable-http 类型）
     */
    handleRequest(connectionId: string, req: IncomingMessage, res: ServerResponse, parsedBody?: unknown): Promise<void>;
    /**
     * 获取连接 ID（用于 GET 请求创建新连接）
     */
    getConnectionId(connectionId: string): string | undefined;
    /**
     * 确保指定连接的 state 已初始化。
     * 用于 POST /acp/connect 端点：先创建 connection state（不建立 SSE），
     * 后续 GET SSE 或 POST 请求可以复用此 state。
     */
    ensureConnectionState(connectionId: string): void;
    /**
     * 判定连接是否仍持有可写的 SSE 通道（即 standaloneSse 存在且未 ended）。
     * 由 AcpConnectionGuard.evictOldest 用于优先剔除已死连接。
     */
    isConnectionAlive(connectionId: string): boolean;
    hasLiveNotificationStream(connectionId: string): boolean;
    /**
     * 判定连接是否有正在进行中的 prompt（inFlightPrompts 非空）。
     * 由 AcpConnectionGuard.evictOldest 用于避免踢掉正在等模型响应的连接，
     * 否则其上层 forwardingPromise 永挂导致 30s "No response received"。
     */
    hasInFlightPrompt(connectionId: string): boolean;
}
/**
 * ACP Agent Manager 接口
 *
 * 管理 ACP 相关实例的生命周期，类似于 AgentTaskManager 的设计模式。
 * 负责注册、获取和清理 AcpAgent 实例。
 */
export interface AcpAgentManager {
    /**
     * 注册 AcpAgent 实例
     * @param connectionId 连接 ID
     * @param agent AcpAgent 实例
     */
    register(connectionId: string, agent: AcpAgent): void;
    /**
     * 获取指定连接的 AcpAgent 实例
     * @param connectionId 连接 ID
     */
    get(connectionId: string): AcpAgent | undefined;
    /**
     * 获取所有已注册的 AcpAgent 实例
     */
    getAll(): Map<string, AcpAgent>;
    /**
     * Subscribe to agent-registered events. Enables the mods paint pipe
     * to push a first-frame MOD_RENDER to a newly-connected webui
     * without waiting for the mod's own `$.ui.invalidate` cadence.
     */
    onAgentRegistered?(cb: (connectionId: string, agent: AcpAgent) => void): () => void;
    /**
     * 移除并释放指定连接的 AcpAgent 实例。重复移除同一连接是 no-op。
     * @param connectionId 连接 ID
     */
    remove(connectionId: string): Promise<void>;
    /**
     * 移除并释放所有 AcpAgent 实例。
     */
    clear(): Promise<void>;
}
/**
 * ACP `usage_update` 推送来源。
 *
 * 设计参见 `docs/workbuddy/2026-05-18-acp-session-usage-context-ring.md`
 * 的 ADR-002（单点订阅 + 关键节点保险）。
 *
 * - `'stream'` 仅在 prompt 中段由 `session.combineSubject` 上 `type: 'input'`
 *   事件触发，**会被 250ms 节流合并**，避免高频累加 usage 时刷屏。
 * - 其它来源全部**立即推送**（绕过节流）：
 *   - `'new_session'` / `'load_session'` / `'resume_session'`：首发，让客户端在第一帧就拿到 0% / 模型 size
 *   - `'prompt_start'`：prompt 刚开始、模型思考/写文件尚未返回真实 usage 的窗口，用本地估算
 *     的输入 token 推一帧占位（used 估算 + byCategory），避免上下文环空白；随后由 stream/prompt_end 校准
 *   - `'prompt_end'`：prompt 出口（无论 stopReason），保证终值正确
 *   - `'compacted'`：压缩（自动/手动）完成后立即推一帧（used = 压缩后 history 估算），环即刻降到新值
 *     而非等下一轮 prompt；publisher 同时重置 turn 高水位，使这次真实下降不被单调约束挡住
 *   - `'model_changed'`：分母切换
 *   - `'cancel'`：用户取消快照
 *
 * usageByCategory 触发拍：
 * - `ACP_USAGE_CATEGORY_SNAPSHOT_SOURCES` 中的路径走**全量**计算并附带
 *   `_meta['codebuddy.ai/usageByCategory']`，sum(usageByCategory) 严格 === update.used。
 * - `'stream'` 路径走**turn 级增量**（见 usage-by-category-incremental），同样附带 usageByCategory，
 *   让「对话进行中」也能实时展示 5 类明细，且不重跑动态 agent instructions（规避控制面阻塞）。
 * - `'model_changed'` 路径**不写**该字段（只同步 context size），客户端复用上次缓存，下次 prompt_end 全量校准。
 * - calculator 计算异常时 publisher 也不写该字段（降级），不影响 used/size/cost 推送。
 */
export type AcpUsageUpdateSource = 'new_session' | 'load_session' | 'resume_session' | 'prompt_start' | 'prompt_end' | 'compacted' | 'model_changed' | 'cancel' | 'stream';
/**
 * 附带 `usageByCategory` 语义快照的推送来源（排除语义见上方
 * `AcpUsageUpdateSource` 注释）。publisher 与其 spec 共用此唯一事实源；
 * 新增 source 时在这里决定它是否参与 category 计算。
 */
export declare const ACP_USAGE_CATEGORY_SNAPSHOT_SOURCES: ReadonlySet<AcpUsageUpdateSource>;
/**
 * ACP usage_update 推送服务（singleton）。
 *
 * 唯一职责：基于 CLI 现有 `session.usage` + 当前模型 `maxInputTokens`，
 * 通过 ACP `connection.sessionUpdate({ sessionUpdate: 'usage_update', used, size })`
 * 主动推送给 ACP 客户端，不修改 `agent-service.ts` / `input-item-processors.ts`
 * / `usage-utils.ts` / `session-protocol.ts` 的现有 usage 计算逻辑。
 *
 * 由 `AcpAgentImpl` 在关键接入点 + `session.combineSubject` 订阅共同驱动；
 * diff 后相同值不重复推送。compact 路径不主动推送，由下次 prompt 自然回填。
 */
export interface AcpUsagePublisher {
    /**
     * 把一个 (session, connection) 配对登记到 publisher 内部状态，
     * 并开始订阅 session 的 `combineSubject` 事件流。
     *
     * 必须由 `AcpAgentImpl.setSession()` 在 session 绑定完成后调用。
     * 对同一个 sessionId 重复调用是幂等的（旧订阅会先 unregister）。
     *
     * @param session    待跟踪的 CLI session
     * @param connection ACP 连接，用于发送 sessionUpdate
     */
    register(session: Session, connection: AgentSideConnection): void;
    /**
     * 解除对指定 sessionId 的订阅、清理节流 timer 与 diff 状态。
     * 在连接关闭或 session 切换时调用。幂等。
     */
    unregister(sessionId: string): void;
    /**
     * 显式触发一次推送（绕过节流）。`source !== 'stream'` 的调用都走这里。
     *
     * - 若该 sessionId 未注册，直接 no-op（防御调用方时序）
     * - 若新值与上次推送值完全相同，跳过（diff 拦截）
     * - 若拿不到 size（model.maxInputTokens 缺失），跳过并 per-session warn 一次
     *
     * 方案 Z（终版决议，2026-05-20）：移除 options.hintUsed 参数 —— compact 完成路径不
     * 再主动推送，由下次 prompt 走 combineSubject(input) 自然回填真实 inputTokens。
     */
    publish(sessionId: string, source: AcpUsageUpdateSource, carrier?: W3CTraceContextMeta, pendingInputText?: string): Promise<void>;
    /**
     * 推送生成工具实际消耗。调用方只提供工具执行事实，publisher 统一复用
     * ACP usage_update.cost.amount 链路，并在内部做 session / stageId 幂等。
     */
    publishGenerationToolCredit(params: {
        sessionId: string;
        credit: number;
        stageId: string;
        messageId?: string;
        requestId?: string;
    }): Promise<void>;
    /**
     * 释放 publisher 的全部内部资源（用于进程退出 / 集成测试 teardown）。
     */
    dispose(): void;
}
/**
 * ACP v2 terminal-output 推送器（RFD https://agentclientprotocol.com/rfds/v2/terminal-output）。
 *
 * 补上「后台命令跑起来之后界面完全静默、只能等模型自己调 TaskOutput」的盲区：
 * BashTool 把命令丢到后台时按 terminalId 主动推 `terminal_update`，客户端据此在
 * 工具卡片与后台任务面板上展示运行中 / 已结束。
 *
 * 推送由客户端能力位 `_meta['codebuddy.ai'].terminalOutput` 守卫，未声明的客户端
 * 行为与改造前完全一致；非 ACP 运行时（纯 TUI / SDK）容器里没有本绑定，调用方
 * 惰性解析取不到即整体 no-op。
 *
 * 全部方法 fire-and-forget 且内部吞异常——推送失败绝不能影响命令执行。
 */
export interface AcpTerminalPublisher {
    /**
     * 通知客户端终端已创建。
     *
     * 应在命令 spawn 成功之后调用：RFD 建议 spawn 前发以便客户端占位，但 execute
     * 抛异常（权限拒绝 / spawn 失败）时提前发出的 create 会变成永远等不到 exitStatus
     * 的孤儿终端，而 `tool_call` 事件本身已经起了占位作用。
     */
    notifyCreated(session: Session, params: {
        terminalId: string;
        command: string;
        cwd: string;
        background?: {
            reason: NonNullable<import('../../vendor/cbc-core/node/index.js').BackgroundTask['backgroundReason']>;
            startedAt: number;
        };
        output?: Buffer;
    }): void;
    /**
     * 通知客户端终端已退出。`exitStatus` 出现即代表已结束——这是客户端判定运行态的
     * 唯一依据，所以任何终止路径（含异常路径）都必须调用，否则客户端会永远停在运行中。
     *
     * `exitCode` 未知时传 `null`，不要兜底成 0，否则会把「未知」谎报成成功。
     */
    /**
     * @param end 可选的结束原因。强烈建议每个调用点都带上：客户端只有 `exitStatus` 时
     *   无法区分「用户取消」「输出超限被强杀」「退出码没采集到」这几种截然不同的结局，
     *   它们今天全部渲染成同一句「已结束」。见 {@link import('./acp-terminal-types').AcpTerminalEndReason}。
     */
    notifyExit(session: Session, terminalId: string, exitStatus: import('./acp-terminal-types').AcpTerminalExitStatus, end?: import('./acp-terminal-types').AcpTerminalEndInfo): void;
    /**
     * 投递一段终端输出字节。**必须传解码之前的原始字节**——base64 的意义正是容纳
     * 非法 UTF-8 与被分片切断的码点，传解码过的字符串会把损坏固化下来。
     *
     * 实现内部按 terminalId 做时间窗合并与分帧，所以调用方可以按任意频率（含每次
     * poller tick、每次 pipe chunk）无脑投递，不需要自己攒批。
     *
     * 受独立能力位 `_meta['codebuddy.ai'].terminalOutputChunk` 守卫：未声明的客户端
     * 一个字节都收不到，也不会退化成推全量快照。
     */
    publishOutput(session: Session, terminalId: string, bytes: Buffer): void;
    /**
     * 把该终端在时间窗里攒着还没发出的字节立刻发完。
     *
     * `notifyExit` 内部已经先调它再发 exitStatus，正常路径不需要外部调用。单独暴露是
     * 给「不走 notifyExit 的收尾路径」兜底用的。
     */
    flushOutput(session: Session, terminalId: string): void;
    /**
     * 丢弃该终端的全部节流状态（待发字节、定时器、累计量）。
     *
     * `notifyExit` 已经包含这一步。会话释放等批量清理路径需要显式调用，否则长跑任务
     * 的节流器会一直挂着——这是本类唯一的常驻状态来源。
     */
    disposeTerminal(terminalId: string): void;
}
