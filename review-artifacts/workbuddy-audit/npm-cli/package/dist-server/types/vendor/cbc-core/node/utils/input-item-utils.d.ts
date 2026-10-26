import { type AcpTerminalStateItem, type AgentInputItem, type AssistantMessageItem, type CustomTitleItem, type FileHistorySnapshotItem, type FunctionCallItem, type FunctionCallResultItem, type HookBlockingDetail, HookEvent, type ResendForkNoticeItem, type UserMessageItem } from '../../../cbc-shared/node/index.js';
type ItemStatus = 'in_progress' | 'completed' | 'incomplete';
export type HookStatus = 'success' | 'blocked' | 'warning' | 'error' | 'mod-log';
interface ItemOptions {
    readonly skipRun?: boolean;
    readonly status?: ItemStatus;
    readonly error?: any;
}
export interface HookMessageOptions extends ItemOptions {
    readonly hookStatus?: HookStatus;
    readonly exitCode?: number;
    /**
     * Whether to wrap the message with chalk secondary color (default true).
     * Pass false for messages that must render cleanly outside the terminal
     * (e.g. forwarded to ACP / Web UI as agent_message_chunk).
     */
    readonly chalk?: boolean;
    /**
     * Structured blocking details (command/exitCode/reason per blocking hook).
     * Forwarded by the ACP layer as _meta['codebuddy.ai/hook'].blocking so
     * clients can precisely identify hook-blocked messages (issue #71907).
     */
    readonly blockingDetails?: HookBlockingDetail[];
    /** Enterprise runtime-security presentation payload forwarded over ACP. */
    readonly runtimeSecurity?: Record<string, unknown>;
}
interface ToolParameters {
    readonly [key: string]: unknown;
}
export declare abstract class InputItemUtils {
    static createToolCallResultItem(output: string, sourceItem: FunctionCallItem, options?: ItemOptions): FunctionCallResultItem;
    /**
     * 尝试从工具 output 文本里识别 MCP/JSON-RPC 标准错误信号：
     * - MCP 协议：`{ isError: true, content: [...] }`
     * - 结构化 JSON：顶层 `{ error: "..." }` 或 `{ error: { message: "..." } }`
     *
     * 只处理明确的 JSON 错误结构，**不**做文本 heuristic 匹配，
     * 避免把正常含 "error" 字样的文本误判为失败。
     */
    private static detectStatusFromOutput;
    static createToolCallItem(toolName: string, parameters: ToolParameters, options?: Pick<ItemOptions, 'skipRun'>): FunctionCallItem;
    static findLatestUserMessage(items: readonly AgentInputItem[]): UserMessageItem | undefined;
    static findLatestConversationRequestId(items: readonly AgentInputItem[]): string | undefined;
    static findLatestUserOrToolCallResultMessageId(items: readonly AgentInputItem[]): string | undefined;
    /**
     * 判断一条消息是否可作为 content-filter 场景的"目标用户消息"。
     *
     * 在 `isRealUserMessageItem` (排除 skipRun / system teammate) 基础上额外排除：
     * - `agent === COMPACT`：compact 子 agent 的内部用户消息
     * - `isAdditionalData`：附带的上下文/附加数据
     * - `isCompactInternal`：compact 流程内部产生的中间消息
     *
     * 仅这四类「外部用户主动输入」的消息，才会在被 content_filter 拦截时，
     * 用其 id 写入 `session.meta.lastContentFilterUserMessageId`。
     *
     * @param item 任意历史项
     * @returns true 表示此条消息可作为 content-filter 关联的目标用户消息
     */
    static isContentFilterCandidateUserMessage(item: AgentInputItem): boolean;
    /**
     * 查找最近一条可作为 content-filter 关联目标的用户消息 id。
     *
     * 查找策略（按优先级）：
     * 1. 若提供了 `preferredId` 且其在 `items` 中命中且通过
     *    `isContentFilterCandidateUserMessage` 校验，直接返回该 id（命中缓存）
     * 2. 否则倒序遍历 `items`，返回第一条通过校验的消息 id
     * 3. 全部不命中返回 `undefined`
     *
     * @param items 会话历史
     * @param preferredId 调用方缓存的"上次用户消息 id"（如 session.lastUserMessageId）
     * @returns 命中的用户消息 id，未命中返回 undefined
     */
    static findLatestContentFilterCandidateUserMessageId(items: readonly AgentInputItem[], preferredId?: string): string | undefined;
    static findLatestMessageId(items: readonly AgentInputItem[]): string | undefined;
    static findLatestConversationRequestItems(items: readonly AgentInputItem[]): AgentInputItem[];
    static createUserMessage(message: string | {
        type: 'input_text';
        text: string;
    }[], options?: ItemOptions): UserMessageItem;
    /**
     * Build the agent-run input for an error-recovery `<system-reminder
     * data-role="error-recovery">` turn (network/stream-timeout/model-error
     * retries, model fallback, etc.).
     *
     * Semantics that differ from {@link createUserMessage} — and the reason
     * this is its own factory rather than `createUserMessage(text, ...)`:
     *  - isMeta: true  → hidden from SDK resume replay and other isMeta-filtered
     *                    consumers, so synthetic recovery turns don't leak into
     *                    the user-visible transcript.
     *  - NOT skipRun   → unlike createUserMessage (which defaults skipRun:true),
     *                    a recovery turn MUST trigger a model run; that's the
     *                    whole point of injecting it.
     *  - startsNewUserRequest:false → recovery continues the current request and
     *                    must not reset request-scoped runtime state.
     */
    static createErrorRecoveryInput(text: string): AgentInputItem[];
    static createAssistantMessage(message: string, options?: ItemOptions): AssistantMessageItem;
    /**
     * content_filter 安全审查终止提示的英文文案。
     *
     * agent-cli 无 locale，history / message 直接存英文（与 agent-ui i18n
     * `message.contentFilter.notice` 的 en 值保持一致）；WB desktop 实时展示时
     * 由 agent-ui 按当前语言本地化（见 adapter 调用 clearTurnForContentFilter 传入的 t() 文案）。
     */
    static readonly CONTENT_FILTER_NOTICE_TEXT = "This topic is currently outside the scope of my capabilities, so I'm unable to discuss it further.";
    /**
     * 创建 content_filter 安全审查“终止占位”消息，替换被过滤那一轮的 agent 输出。
     *
     * 设计要点：
     * - content 存英文提示文案（agent-cli 无 locale）；重放历史时直接展示该文本。
     * - parentId 指向“被过滤这一轮之前”的节点（通常是触发的 user 消息）：history 是 append-only，
     *   靠 parentId fork（HistoryUtils.getActiveHistory 从尾部沿 parentId 回溯会跳过被过滤的一轮），
     *   无需重写历史文件。
     * - providerData.contentFilterNotice=true：贯穿标记，供 HistoryUtils.applyContentFilterCleanup
     *   把它从下一轮 model input 中排除（不再发回模型）。
     * - providerData.strippedUserMessageId：触发安全审查的那条 user 消息 id。notice 是持久化的，
     *   applyContentFilterCleanup 每轮据此把该 user 消息也从 model input 中排除（**持久**，非一次性），
     *   从而让被过滤这一轮的 user 消息既保留在可见历史中、又永不回传模型。
     * - providerData.messageId：对齐被过滤响应的 messageId，便于幂等判断与排查。
     * - providerData.conversationRequestId：被过滤这一轮的 requestId。该轮的模型产出整体离链后，
     *   notice 是唯一还留在活跃链上、能代表这一轮的节点；file-rollback 按活跃链上的 requestId
     *   决定要还原哪些轮次的文件改动，缺了它该轮工具真实写过的文件回退时会被漏掉。
     * - skipRun=true：不触发模型重跑。
     */
    static createContentFilterNoticeMessage(messageId: string, parentId?: string, strippedUserMessageId?: string, conversationRequestId?: string): AssistantMessageItem;
    /** 判断某条 history/input item 是否为 content_filter 安全审查占位消息 */
    static isContentFilterNoticeItem(item: AgentInputItem): boolean;
    /** 判断某条 history/input item 是否为 UserPromptSubmit hook 阻断提示（issue #71907） */
    static isHookBlockedMessageItem(item: AgentInputItem): boolean;
    static createHookMessage(message: string, options?: HookMessageOptions, hookEvent?: HookEvent, callId?: string): AssistantMessageItem;
    static isSkipRunItem(item: AgentInputItem): boolean;
    /**
     * 判断一条排队消息是否为「Tab 入队」的 queue-hold 消息。
     *
     * queue-hold 语义（对齐 codex「tab in queue」）：该消息在当前 turn 运行期间
     * **不**被 MessageQueueRequestProcessor 作为 <system-reminder data-role="message-queue">
     * 注入（即不 mid-run steer），而是 hold 在 session.queue 里，等 agent idle 后才作为
     * 新一轮普通输入 drain 出去。Enter 入队的消息不带此标记，保持现状的实时 steer。
     */
    static isQueueHoldItem(item: AgentInputItem): boolean;
    /**
     * True only for steering submitted through the ACP v2 prompt extension.
     * Unlike the product's generic send-now queue, protocol steering must be
     * injected at the active run's next model checkpoint in both queue modes.
     */
    static isAcpSteerItem(item: AgentInputItem): boolean;
    /**
     * 构造一条「Tab 入队」的 queue-hold 用户消息。
     *
     * 仅在 providerData 上打 queueHold:true，不设 skipRun/isMeta —— 这样它仍被
     * isEditableQueuedMessage 判为可编辑（可被 ↑ / ⌥+↑ 拉回输入框），也能在 idle 时
     * 正常 drain。与普通 user() 消息的唯一区别就是 queueHold 标记。
     */
    static createQueueHoldUserMessage(text: string): UserMessageItem;
    static isManualToolCall(item: AgentInputItem): boolean;
    static isUserMessageItem(item: AgentInputItem): item is UserMessageItem;
    static isRealUserMessageItem(item: AgentInputItem): item is UserMessageItem;
    /**
     * 判断实时输出流中的 user item 是否应作为正常用户输入回显。
     *
     * 实时 item 带有完整 providerData，因此这里只信任结构化标记，不使用
     * compact / teammate 的内容正则兜底。后者仅用于兼容缺少标记的旧历史；
     * 若用于实时流，会把用户粘贴的 `<cb_summary>` 等文本误判成内部消息。
     */
    static isLiveStreamUserMessageItem(item: AgentInputItem): item is UserMessageItem;
    /** A user-visible stream-json echo, excluding framework context and meta triggers. */
    static isUserMessageAckEligible(item: AgentInputItem): item is UserMessageItem;
    /**
     * 判断一条消息是否为「会话外部真正发来的新用户请求」。
     *
     * 显式新输入按结构化标记判断，未标记输入保留 `isRealUserMessageItem` 兜底；排除：
     * - `agent === COMPACT`：compact agent 的内部用户消息
     * - `isAdditionalData`：附带的上下文/附加数据
     *
     * `isMeta` 只表示消息不应作为普通用户输入展示，不能单独证明它是同一 request
     * 内的续跑（例如 cron 触发的独立请求同样是 meta）。调用方可通过
     * `startsNewUserRequest` 显式覆盖：`true` 表示新请求，`false` 表示内部续跑；
     * 未标记时为兼容现有入口，普通消息视为新请求、meta 消息视为内部续跑。
     *
     * 用于界定「新用户请求边界」——跨请求才应重置的运行时状态（如
     * `consecutiveMaxTokenCompactCount`）以此为准，避免恢复重试刷新预算。
     */
    static isExternalUserPromptItem(item: AgentInputItem): item is UserMessageItem;
    /**
     * 判断一条用户消息是否为「运行时注入的内部续跑」——不是用户发来的提问。
     *
     * 判据是两个标记**同时**成立：`isMeta`（不作为普通用户输入展示）与
     * `startsNewUserRequest === false`（延续当前 request，不是新回合）。缺一不可：
     *
     * - 只看 `startsNewUserRequest === false` 会误伤**排队的真实用户消息**——
     *   `rich-queue-manager` / `injectable-content` 给它们打这个标记是为了「回合中途注入、
     *   不重置请求级状态」，但它们确确实实是用户提问。
     * - 只看 `isMeta` 又太宽：通知注入（`buildNotificationInjectionInput`）、团队接管、
     *   agent-home 提醒、结构化输出续跑都带 isMeta，却各有自己的语义。
     *
     * 当前恰好命中两个生产方，都是运行时自己塞进去让模型接着干的：
     * `InputItemUtils.createErrorRecoveryInput`（截断续写 / 网络重试 / 流超时 / 模型降级）
     * 与 runner-factory 的 `'Please continue.'`。
     *
     * 用途是让「把用户输入当作新回合起点」的消费方（会话标题、外部 UserPromptSubmit hook）
     * 区分真实提问与内部机制——否则一条 3 次的恢复链会被当成 4 次用户提问。
     */
    static isInternalContinuationItem(item: AgentInputItem): boolean;
    /**
     * 检查是否为框架自动发送的队友消息（非用户主动输入）
     * 这类消息由 AgentTaskManager 在后台任务完成时自动生成
     */
    static isSystemTeammateMessage(item: AgentInputItem): boolean;
    /**
     * 判断一条排队消息是否可被「↑ 编辑」拉回输入框。
     *
     * 只有用户主动输入的纯文本 prompt 才可编辑。系统注入的排队项
     * （异步 agent 通知、channel 消息、teammate 消息、isMeta 内部消息、
     * skipRun 中断消息等）携带原始 XML / 业务语义，绝不能泄漏进用户输入框，
     * 因此一律视为不可编辑，保留在队列里继续被自动 drain。
     *
     * 对齐 Claude Code 的 isQueuedCommandEditable（src/utils/messageQueueManager.ts）。
     */
    static isEditableQueuedMessage(item: AgentInputItem): boolean;
    /**
     * 提取用户排队消息中的纯文本内容（用于回填输入框编辑）。
     * 多个 input_text 片段以换行拼接；非文本片段（如图片）被忽略。
     */
    static extractEditableText(item: AgentInputItem): string;
    /**
     * 提取用户排队消息里的图片，用于「拉回输入框编辑」时重新注册图片，避免图片丢失。
     *
     * 返回 `{ placeholderId, dataUrl }` 列表：`placeholderId` 取自消息文本里的
     * `[Image #N]` 占位符（按出现顺序），`dataUrl` 取自 content 中对应顺序的
     * `input_image` 块。二者按顺序 zip —— `createUserMessageWithMultipleImages`
     * 构造消息时正是「按占位符顺序」push 图片块的，所以顺序一一对应。
     *
     * 消费方（paste 层）据此把 data URL 写回临时文件并按原 placeholderId 重新注册，
     * 从而让回填文本里原样保留的 `[Image #N]` 占位符能重新解析出图片。
     */
    static extractEditableImages(item: AgentInputItem): Array<{
        placeholderId: number;
        dataUrl: string;
    }>;
    static isCustomInputItem(item: AgentInputItem): boolean;
    static isFileHistorySnapshotItem(item: AgentInputItem): item is FileHistorySnapshotItem;
    /**
     * 创建一个 resend/edit fork 墓碑标记 item（issue #50495）。
     *
     * @param forkPoint 被编辑用户消息的 parentId（与 fork 后新 user 同 parent，root 时为 undefined）
     * @param editedUserItemId 被编辑 user 消息的 CLI item id（仅用于日志/排查）
     *
     * 通过 SessionManager.addHistory 或 SessionStore.rewindSession 持久化到 JSONL。
     * 冷加载时由 HistoryUtils.resolveReplayHistory 识别；尚未追加新普通消息时，
     * 标记的 parentId 就是恢复位置（undefined 表示空分支）。
     */
    static createResendForkNoticeItem(forkPoint: string | undefined, editedUserItemId?: string): ResendForkNoticeItem;
    /** 判断某条 history item 是否为 resend/edit fork 墓碑标记（issue #50495） */
    static isResendForkNoticeItem(item: AgentInputItem): item is ResendForkNoticeItem;
    static isAcpTerminalStateItem(item: AgentInputItem): item is AcpTerminalStateItem;
    static isAssistantMessage(item: AgentInputItem): boolean;
    static isSessionSeparatorItem(item: AgentInputItem): boolean;
    static isUserInterrupted(item: AgentInputItem): boolean;
    static readonly TURN_ABORTED_TAG_OPEN = "<turn_aborted>";
    static readonly TURN_ABORTED_TAG_CLOSE = "</turn_aborted>";
    /**
     * 取消轮在模型输入里的说明文案。
     *
     * 逐字沿用 Codex `core/src/context/turn_aborted.rs` 的 INTERRUPTED_GUIDANCE，
     * 只把它自家的 "unified exec processes" 换成本 CLI 真实存在的 "background tasks"
     * （Bash 的 run_in_background、后台 Agent）——照抄不存在的概念会误导模型。
     */
    static readonly TURN_ABORTED_GUIDANCE: string;
    /**
     * 把一条已落史的取消边界（assistant "Interrupted by user"）投影成模型可见的
     * user 角色中断标记，对齐 Codex：原 prompt 留在历史里，后面紧跟一条
     * `<turn_aborted>` 说明，下一轮用户输入再接在后面。
     *
     * 只用于构造当轮模型输入，不落盘：transcript 与 UI 继续显示原来那条 assistant
     * 占位（见 `interruption-service`），所以 id / parentId 沿用边界项——既让
     * 父链遍历仍然成立，也保证同一段历史每轮投影出的 id 稳定（换成随机 id 会让
     * 模型输入每轮都变，破坏 prompt 缓存）。
     *
     * providerData 整体继承而不是重建：投影只改"角色 + 文本"这两件事，边界上的
     * 结构化标记（`agent` / `truncated` 等）仍被后续管线用来做过滤决策
     * （`replaceCompactWithSummary` 认 `agent`、`filterTruncatedHistory` 认
     * `truncated`），重建一个干净 providerData 会让这些决策静默改变。
     */
    static createTurnAbortedMarker(boundaryItem: AgentInputItem): UserMessageItem;
    static isTurnAbortedMarker(item: AgentInputItem): item is UserMessageItem;
    static isSuccessfulFunctionCallResultItem(item: AgentInputItem): item is FunctionCallResultItem;
    static isCompactBoundaryMessage(item: AgentInputItem): boolean;
    /**
     * 仅凭 providerData 结构化标记判定 compact boundary，不使用内容正则兜底。
     *
     * 会删除或改写消息的路径（如 replaceCompactWithSummary）必须用这个版本：
     * 内容兜底会把用户粘贴的 `<cb_summary>` / `<conversation_history_summary>` 文本
     * 误判为 boundary，导致真实用户输入被移除。
     */
    static isStructuredCompactBoundaryMessage(item: AgentInputItem): boolean;
    static isReplayRecoverableCompactMessage(item: AgentInputItem): item is UserMessageItem;
    static isCompactUserMessage(item: AgentInputItem): item is UserMessageItem;
    static isCompactEnvelopeMessage(item: AgentInputItem): item is UserMessageItem;
    private static hasCompactBoundaryContent;
    static isCompactContinuePromptMessage(item: AgentInputItem): item is UserMessageItem;
    private static hasTeammateMessageContent;
    private static getUserMessageText;
    /**
     * 创建包含文本和图片的用户消息
     */
    static createUserMessageWithImage(text: string, imagePath: string, imageFormat?: string): Promise<UserMessageItem>;
    /**
     * 创建以图片为主的用户消息；若图片被省略则回退为文本占位符
     */
    static createImageOnlyUserMessage(imagePath: string, imageFormat?: string): Promise<UserMessageItem>;
    /**
     * 创建包含文本和多个图片的用户消息
     * 支持按 [Image #N] 占位符顺序插入对应图片，原始占位符文本会保留
     */
    static createUserMessageWithMultipleImages(text: string, imageMap: Map<number, {
        path: string;
        format: string;
    }>): Promise<UserMessageItem>;
    static isRenameMessage(item: AgentInputItem): item is CustomTitleItem;
}
export {};
//# sourceMappingURL=input-item-utils.d.ts.map