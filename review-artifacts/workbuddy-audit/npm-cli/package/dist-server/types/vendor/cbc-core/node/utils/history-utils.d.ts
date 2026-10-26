import { type Agent, type AgentInputItem, type FileHistorySnapshotItem, type FunctionCallItem, type FunctionCallResultItem } from '../../../cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import type { ConversationParentOverlay } from '../session/session-protocol';
import { CompactSummaryNotFoundError } from './summary-utils';
export { CompactSummaryNotFoundError };
/**
 * 压缩链路三层 hidden context role 的显式清单（对齐 packages/agent-client-protocol）：
 * - USER_CONTEXT_ROLE：常态化，压缩整块保留、续聊时还原（extractUserContextFromHistory 只抽它）
 * - CURRENT_CONTEXT_ROLE：会话内动态，压缩提取四类标签最后一份重组回填（extractCurrentContextFromHistory）
 * - ADDITIONAL_DATA_ROLE：一次性，压缩可剥离、续聊时不还原（不在此处抽取 = 不还原）
 *
 * 显式列出让"不还原一次性数据"成为可 grep 的声明，而非隐式依赖正则不匹配。
 */
export declare const PROMPT_CONTEXT_ROLES: readonly ["user-context", "current-context", "additional-data"];
export declare abstract class HistoryUtils {
    static readonly PRESERVE_GENERAL_PURPOSE_TASK_HISTORY = "preserveGeneralPurposeTaskHistory";
    /**
     * 获取可供 Agent 使用的活跃历史记录
     * 获取活跃对话链（过滤废弃分支），并且滤自定义类型消息
     *
     * @param history 完整的历史记录数组
     * @param options 选项对象，包含 lastMessageId 和 hasCompactedHistory
     * @returns 处理后的活跃历史记录，仅包含 Agent 可处理的消息类型
     */
    static getActiveAgentOnlyHistory(history: AgentInputItem[], options?: {
        lastMessageId?: string;
        hasCompactedHistory?: boolean;
    }): AgentInputItem[];
    /**
     * Replay/重放场景的"活跃历史"解析——所有重放消费方（ACP session-replay、stream-json-view 等）
     * 共用的**单一入口**，确保 parentId fork（content_filter 被过滤那一轮 / edit-resend / compact 的
     * 废弃分支）只在一处维护。
     *
     * 处理 lastMessageId 缺省（冷加载 replay 早于运行态 lastMessageId 还原）的回退：
     *  - lastMessageId 已知 → 走 getActiveHistory（沿 parentId 从指定节点回溯，fork 生效）；
     *  - lastMessageId 缺省且尾部 rewind 标记后尚无普通消息 → 使用标记的 parentId，
     *    无 parentId 明确表示空分支；尾部元数据不改变这个选择；
     *  - lastMessageId 缺省且存在 content_filter 或 resend-fork 标记，分支已继续写入
     *    普通消息 → 走 getActiveHistory，从新分支末端回溯并跳过废弃分支；
     *  - 其他冷加载 replay → 原样返回，保持旧的全量重放语义。不能仅因为存在 parentId
     *    就从尾部回溯：Chat Completions raw item 会让同一 response 的 assistant message
     *    和 function_call 共用 id，active-chain 需要唯一节点 id，盲目回溯会漏消息。
     *
     * @param keepCustomItems 是否保留 custom item（file-history-snapshot / topic 等）。
     *   stream-json-view 需要（它会自行渲染这些）；ACP replay 不需要（传 false 等价于 getActiveAgentOnlyHistory）。
     */
    static resolveReplayHistory(history: AgentInputItem[], options: {
        lastMessageId?: string;
        hasCompactedHistory?: boolean;
        keepCustomItems?: boolean;
        recoverLegacySelfParentCompact?: boolean;
    }): AgentInputItem[];
    /**
     * Preserve an explicitly selected custom journal item beside the active
     * conversation chain. The custom item must point at an active item via
     * `parentId`; abandoned fork markers therefore cannot leak into replay.
     */
    static resolveReplayHistoryWithSelectedCustomItems(history: AgentInputItem[], options: {
        lastMessageId?: string;
        hasCompactedHistory?: boolean;
        recoverLegacySelfParentCompact?: boolean;
        parentOverlay?: ConversationParentOverlay;
    }, include: (item: AgentInputItem) => boolean): AgentInputItem[];
    /**
     * Return the durable conversation head encoded by a trailing rewind marker.
     *
     * A marker followed by a normal conversation item is already committed as
     * an older branch point; the newer item becomes the head. A marker with
     * only custom metadata after it is still pending and must restore its
     * parent, including the explicit `undefined` root. Scanning backwards also
     * gives repeated rewinds "latest marker wins" semantics.
     */
    static findPendingResendForkHead(history: readonly AgentInputItem[]): {
        found: false;
    } | {
        found: true;
        lastMessageId: string | undefined;
    };
    private static recoverLegacyReplayParents;
    /**
     * 修复旧版本 hook 阻断提示留下的断链（issue #156425）。
     *
     * 修复前的实现把阻断提示的 `parentId` 指向**同轮未落盘**的用户输入；进程重建后
     * 该父节点不存在，`getActiveHistory` 走到这里就停住，模型只能看到阻断提示和
     * 之后的消息。原始输入不落盘是既有的安全语义，这里只在**读取时**把断链的
     * 阻断提示接回它在文件序上最近的、仍可恢复的前驱：
     *
     * - 只处理 `hookStatus === 'blocked'` 且 parentId 在本次加载中找不到的条目；
     * - 锚点取文件序上最近的非 custom、非装饰性 mod-log 条目（阻断提示是回合终点，
     *   写盘时紧跟其前驱）；mod-log 不挂父链，跟过去同样会断链；
     * - 遇到 `/clear` 分隔线即停，锚点置空，绝不跨到清空前的内容；
     * - 遇到 rewind/edit 墓碑即停，沿用墓碑的 parentId，不把废弃分支接回来；
     * - 只改内存中的读取结果，不重写 JSONL。
     */
    static repairDanglingHookBlockedParents(history: AgentInputItem[]): void;
    private static findPreviousReplayItemId;
    /**
     * 从 `startId` 沿 parentId 链向上回溯，返回第一个满足 `predicate` 的 item（含 startId 自身）。
     *
     * 与 getActiveHistory 保持同一套父指针判据：overlay 中登记过的 id 一律以 overlay 为准
     * （ConversationHistoryAnalyzer 在检测到环 / 断链 / 重复 id 时产出的运行时修复），
     * 否则才用原始 parentId。不跟随 logicalParentId —— 跨 compact 边界时链自然断开、
     * 返回 undefined，调用方按"找不到"处理即可，避免误穿到压缩前的历史。
     *
     * 自带 seen 集合，环形链不会死循环。
     */
    static findNearestAncestor(history: AgentInputItem[], startId: string | undefined, predicate: (item: AgentInputItem) => boolean, parentOverlay?: ConversationParentOverlay): AgentInputItem | undefined;
    private static parentChainReaches;
    /**
     * 冷加载（`lastMessageId` 丢失）时挑选活跃分支的末端消息。
     *
     * 朴素做法是直接取 history 数组最后一条非 custom 消息，但会话发生过**纯回退**
     * （rewind：只截断、不重发）后，JSONL 末尾就是那条已被回退的旧分支消息 ——
     * 以它为起点回溯，整条废弃分支会被当成活跃历史喂回模型
     * （表现：回退后模型仍知道被删产物的细节，反复提示"xx 已经生成过了"，#59319）。
     *
     * 因此先看最后一条 fork 墓碑（`resend-fork-notice`，持久化在 JSONL 里）：
     * - 墓碑之后若还有非 custom 消息 → 那是 fork 后的新分支，取其末端（resend/edit 场景）；
     * - 墓碑之后没有新消息 → 说明是纯回退，回退点就是墓碑的 `parentId`，以它为起点。
     *
     * 找不到墓碑时退回原有语义（取数组末尾），保持既有会话行为不变。
     */
    private static resolveColdStartTargetId;
    /**
     * 获取活跃对话链的历史记录
     * 当用户回退到某条消息并重新发送时，会产生分叉。此方法过滤掉废弃的分支，
     */
    static getActiveHistory(history: AgentInputItem[], options?: {
        lastMessageId?: string;
        hasCompactedHistory?: boolean;
    }): AgentInputItem[];
    /** 倒序查找当前会话树最后一个 FileHistorySnapshotItem 数据 */
    static findLastFileHistorySnapshotItem(history: AgentInputItem[]): FileHistorySnapshotItem | undefined;
    static hasRealUserMessageItem(inputItems: AgentInputItem[]): boolean;
    /** A bounded resume window may contain work but no longer contain its user prompt. */
    static hasResumableHistory(history: AgentInputItem[]): boolean;
    /**
     * 基于会话分隔线（/clear）切分历史消息。
     * 从后往前查找最后一个 session separator，返回该分隔线之后的所有消息
     * （不含分隔线本身，分隔线是 UI 标记，不送给模型）。
     *
     * 识别规则（满足其一即可）：
     * 1. 新版：`providerData.isSessionSeparator === true`
     * 2. 老版兼容：`role:'system'` 且 id 以 `session-separator-` 或 `clear-` 开头
     *    （老版本写入的数据没有 providerData.isSessionSeparator 标记）
     *
     * 若不存在分隔线，则原样返回。
     * 对齐老版本 agent-craft SmartBoundaryHistoryLoadingStrategy 的 `/clear` 语义。
     */
    static getSessionSeparatorHistory(history: AgentInputItem[]): AgentInputItem[];
    /**
     * 获取压缩流程应处理的 history 视图。
     *
     * 与 HistoryAgentRunInterceptor 的请求前过滤语义保持一致：
     * - compact summary 边界需要保留，因为它携带累计摘要；
     * - `/clear` 是流程边界，本身不应进入下一轮压缩内容；
     * - PTL/media recovery marker 不是压缩边界，不能在这里截断历史。
     */
    static getCompactionBoundaryHistory(history: AgentInputItem[]): AgentInputItem[];
    /**
     * 判定一条历史项是否是 `/clear` 写入的 session separator。
     * 包含对老版本（无 providerData.isSessionSeparator）数据的 id 前缀兼容。
     */
    private static isSessionSeparatorItem;
    /**
     * 过滤已压缩的历史消息。
     * 找到最后一个 compact 消息段，过滤掉该段之前的所有消息，
     * 但保留 compact 消息段本身和之后的消息。
     *
     * 对于后续（非 compact）agent run：compact 消息段也需要过滤掉。
     * 这通过 replaceCompactWithSummary 方法完成，由 HistoryAgentRunInterceptor 在非 compact agent 时调用。
     *
     * 只匹配**已完成的** compact 段（同时包含 compact user 和 compact assistant 消息）。
     * 正在进行中的 compact（只有 user message，还没有 assistant 回复）不会被识别为 compact 段，
     * 确保 compact agent 运行时能看到完整的对话历史。
     */
    static getCompactHistory(history: AgentInputItem[]): AgentInputItem[];
    /**
     * 判断文本内容是否符合 compact 输出的结构（含 <summary> 或 <conversation_history_summary> 标签）。
     *
     * compact prompt (build/patches/cli-saas/templates/compact-prompt.tpl) 强制模型输出嵌套结构
     * `<conversation_history_summary><summary>...</summary></conversation_history_summary>`,
     * 模型偶尔只输出外层或只输出内层都视为"真完成"；
     * 取消/失败路径（如 SDK 写入 "Interrupted by user" 兜底文本、PTL 错误消息等）不会含这两个标签。
     *
     * 这是"内容结构判据"替代 status+rawUsage 字段判据——后者依赖 SDK 写入字段的稳定性,
     * 但多 provider 场景下字段写入不一致（见 FEEDBACK_USAGE_UTILS_GET_LATEST_SCANS_HISTORY_PROVIDER_DATA）；
     * 内容结构由 prompt 强制保证,更稳定。
     */
    static hasCompactOutputStructure(text: string): boolean;
    /**
     * 判断"上一次 compact 之后是否产生了实质性的新内容"。
     *
     * 触发场景（issue #34798 已确认事实）：
     * - 第一次 auto-compact 跑通，产生了正常摘要。
     * - 第二次 pre-message compact 的 rawUsage.prompt_tokens 只有 6101。
     * - 这次 compact 输出了"我需要实际的对话历史…选项 A/B/C…"的无效摘要。
     * - 该无效摘要作为 <system-reminder data-role="compact-summary"> 注入到下一轮请求。
     *
     * 未在这里假设 40 分钟空白的原因；只根据 history 中是否有实质新增内容做保护。
     *
     * 防护策略：在 compact 触发前判断 compact 段后是否真的有用户/工具产出的"新对话"。
     * 没有时直接 skip 整个 compact run，避免生成垃圾摘要。
     *
     * "实质性内容" 定义：
     * - 排除 compact 自己产出的 user/assistant 消息（providerData.agent === 'compact'）
     * - 排除 compact 内部消息（providerData.isCompactInternal）
     * - 排除空 reasoning（content[] 为空，模型还没真正思考）
     * - 排除 file-history-snapshot（纯文件快照不算对话内容）
     * - 排除 summary 等 custom 项
     * - 保留：非空 assistant 消息、function_call/function_call_result（工具调用）、真实用户消息
     *
     * 当 history 中本就没有 compact 段（首次 compact）时，认为存在新内容（返回 true），
     * 让 caller 正常进入 compact 流程。
     *
     * @param history 完整历史（建议传 getActiveAgentOnlyHistory 之后的结果，与 compact agent 实际看到的对齐）
     * @returns true 表示有实质新增可压缩；false 表示距上次 compact 没产出，应 skip
     */
    static hasMeaningfulNewHistorySinceLastCompact(history: AgentInputItem[]): boolean;
    /**
     * CLI TUI 手打 `/compact` 裸跑 vs Blocking 合成 trigger 的判据。
     *
     * BlockingCompactStrategy 合成的 `/compact` / `/_compact` 一定带
     * `providerData.isCompactInternal=true`；用户在 TUI 手打的那条不带。
     * 从最近一条 compact assistant 往前找 trigger user 消息，据此判断本次
     * 是否需要补发 SessionStart('compact')（策略路径已由 sendContinueMessage 负责）。
     */
    static isUserInitiatedBareCompactRun(history: AgentInputItem[] | undefined): boolean;
    /**
     * 判断 user 消息是否为 `/compact` / `/_compact` 触发（含 compact agent 内部 trigger）。
     * 不把 sendContinueMessage 注入的 "Please continue..." 当成 trigger。
     */
    private static isCompactSlashCommandTrigger;
    /**
     * 判断一条 assistant message 的 content 是否含非空文本。content 缺省/异常
     * 视为无文本（返回 false）——只承载 tool_call 而无文本的那一轮即属此类。
     */
    private static assistantMessageHasText;
    /**
     * 单项判定：当前 item 是否算"实质性的新内容"。
     * 见 hasMeaningfulNewHistorySinceLastCompact 的"实质性内容"定义。
     */
    private static isMeaningfulPostCompactItem;
    /**
     * 从 history 中提取 **最近一次成功的压缩摘要**(即 <summary>…</summary> /
     * <conversation_history_summary>…</conversation_history_summary> 包裹的正文)。
     *
     * 规则(与 replaceCompactWithSummary / getCompactHistory 对齐):
     *   1. 查看 compact-agent assistant，或 PreMessage/MaxToken 写入的显式 compact boundary
     *   2. 从后向前扫描,命中第一条可用摘要即返回
     *   3. compact assistant 继续要求结构化 summary envelope；显式 boundary 同时支持
     *      工程压缩的 `<cb_summary>` 与 LLM summary envelope
     *   4. 全程扫描都拿不到 → 返回 `undefined`(history 中**从未**出现过合法摘要)
     *
     * ⚠️ 不适合用于"判断本次 compact run 是否成功"!
     *   本方法会读到 **历史上任意一次** 成功的摘要,无法识别"以前压缩成功过、本次失败"。
     *   要判断本次 run,请改用 `SummaryUtils.requireCompactSummaryFromText` 直接对
     *   `RunResult.finalOutput` 求值。
     *
     *   本方法保留给 view 层使用(replaceCompactWithSummary 在新一轮 agent run 之前
     *   注入摘要,只关心"history 里有没有可用的摘要",不关心来源是哪一次)。
     */
    static extractCompactSummaryFromHistory(history: AgentInputItem[]): string | undefined;
    /**
     * 与 `extractCompactSummaryFromHistory` 相同的提取语义,但找不到时抛出
     * `CompactSummaryNotFoundError` 而非返回 undefined。
     *
     * ⚠️ 见 `extractCompactSummaryFromHistory` 的"不适合"注释 — 本方法对"本次
     * compact run 是否成功"的判断仍不可靠。
     */
    static requireCompactSummaryFromHistory(history: AgentInputItem[]): string;
    /**
     * 将 compact 消息替换为包含 wrappedSummary 的 user 消息。
     * 1. 从 compact assistant 消息中提取 <summary> 内容并包装
     * 2. 始终移除所有 compact 消息（防止内部 XML 标签泄漏到主 agent 输入）
     * 3. 若提取到 summary，在 history 开头插入一条包含 wrappedSummary 的 user 消息
     *
     * 2026-05-14 更新原则：
     *   无论压缩是否成功，都必须过滤 compact agent 的内部消息。
     *   压缩失败（提取不到 <summary>）时仅过滤、不注入摘要；
     *   压缩成功时过滤并注入 wrappedSummary。
     *   始终过滤的原因：compact 内部消息包含 <conversation_history_summary> 等 XML 标签，
     *   若暴露给主 agent 会导致其在输出中回显这些标签。
     *
     * @param transcriptPath session jsonl 文件路径，用于包装后缀中的 transcript 链接
     */
    static replaceCompactWithSummary(history: AgentInputItem[], transcriptPath: string): AgentInputItem[];
    static filterTaskHistory(agent: Agent<any, any>, history: AgentInputItem[], session?: {
        meta?: Record<string, unknown>;
    }): AgentInputItem[];
    /**
     * 找到最后一条明确的 compact boundary 消息（压缩结果），
     * 丢弃它之前的所有历史项，只保留该消息及其后的内容。
     *
     * PreMessageCompactStrategy 和 MaxTokenCompactStrategy append 的压缩结果
     * 可能来自不同历史版本：新数据带 `isCompacted`，部分 LLM summary 历史只带
     * `isSummary`，compact 内部历史带 `isCompactInternal + compactType/agent=compact`。
     *
     * 如果 history 中没有 compact boundary 消息，则原样返回。
     */
    static filterBeforeCompactedMessage(history: AgentInputItem[]): AgentInputItem[];
    /**
     * Extract the `<system-reminder data-role="user-context">` block from the first user
     * message in session history. This block contains static environment information
     * (user_info, project_context, etc.) that must be restored after compaction because
     * the continue message bypasses agent-craft's UserContextMiddleware pipeline.
     *
     * 只抽取 user-context（常态化，压缩保留）；additional-data（一次性，压缩可剥离）
     * 不在抽取范围 —— 压缩续聊时不需要还原一次性附加数据（current_time / attached_files
     * / tdrive_attachments 等本轮触发内容，压缩后续聊不还原）。
     *
     * Returns the full `<system-reminder ...>...</system-reminder>` string, or undefined
     * if not found.
     */
    static extractUserContextFromHistory(history: AgentInputItem[]): string | undefined;
    /**
     * Extract the `<system-reminder data-role="current-context">` content for compact continue.
     *
     * current-context 是「每轮只发变化块」的动态层（identity_context / mode / ardot-context /
     * connector-status 四类白名单标签），其变化块散布在整段历史里。压缩续聊时与 user-context
     * 不同：不能只取首条消息，而要扫描整段历史，取每类标签「最后一次出现」的内容（生产侧
     * 「只发变化块」保证历史里每类标签的最后一次即最新值），再按协议层固定顺序重组回填。
     *
     * 复用协议层 reassembleCurrentContext（固定顺序唯一耦合点），避免手抄顺序漂移。
     *
     * Returns the reassembled `<system-reminder ...>...</system-reminder>` string, or undefined
     * if no whitelist tag ever appeared in history.
     */
    static extractCurrentContextFromHistory(history: AgentInputItem[]): string | undefined;
    /**
     * 剥离文本中**所有** `<system-reminder data-role="user-context">...</system-reminder>` 块。
     *
     * 供工程压缩器（HistoryEngineeringCompactor）在写入 `<cb_summary>` 前做防御性清理：
     * 即便上游某条路径把 user-context 内联进了 isCompactInternal/isSummary 消息（例如
     * HistoryAgentRunInterceptor 就地 unshift 污染了持久化 summary），也不会被抄进压缩产物、
     * 更不会随 getCompactionBoundaryHistory 逐轮累积（滚雪球）。
     *
     * user-context 属常态化上下文，正常由请求前拦截器整块回填，无需进入压缩正文。
     */
    static stripUserContextReminders(text: string): string;
    /**
     * 剥离文本中**所有** `<system-reminder data-role="current-context">...</system-reminder>` 块。
     *
     * 与 stripUserContextReminders 同源：current-context（identity_context / connector-status
     * 等动态标签）与 user-context 一样属「常态化上下文」，压缩续聊时由请求前拦截器从历史重新
     * 提取重组回填，无需进入压缩正文。工程压缩器写 `<cb_summary>` 前剥离，避免标签被抄进
     * 压缩产物逐轮累积。
     */
    static stripCurrentContextReminders(text: string): string;
    /**
     * 拼接 user 消息的纯文本内容（content 为字符串或 input_text 数组）。
     * 非 user 消息或无文本时返回 undefined。
     */
    private static getUserMessageFullText;
    /** user 消息的各个文本 part（字符串 content 视为单个 part），保持原顺序。 */
    private static getUserMessageTextParts;
    /**
     * 判断 input 中是否已存在「指定的」user-context 块（按内容精确包含比对）。
     *
     * 用于注入完整 user-context 前去重：user-context 存在两种形态——
     *   - 完整版（首条消息）：含 user_info / identity_context / project_context 等静态环境信息；
     *   - 精简版（后续轮次）：仅 current_time + special_instructions。
     * 压缩续聊要还原的是「完整版」，因此不能仅凭 input 里出现了任意 user-context（可能是精简版）
     * 就跳过注入，必须精确比对目标完整版是否已在 input 中，避免漏注入或重复注入。
     */
    static containsUserContext(input: AgentInputItem[], userContext: string): boolean;
    static filterTruncatedHistory(history: AgentInputItem[]): AgentInputItem[];
    /**
     * 把用户取消的轮次投影成模型可见的"被打断"语义，对齐 Codex
     * （`core/src/tasks/mod.rs` 在 TurnAbortReason::Interrupted 时记入一条
     * user 角色的 `<turn_aborted>`）：原 prompt、已发生的工具记录都留在模型
     * 输入里，取消边界本身换成一条 user 角色的中断说明。
     *
     * 于是下一轮模型看到的是「原问题 → 中断说明 → 新问题」三段，既知道上一个
     * 请求没做完，也不会把它当成仍待执行的指令。
     *
     * 只处理已落历史的标准取消形态：skipRun 的 assistant "Interrupted by user"
     * （由 `interruption-service` 写入），且该边界确实终结了一个**尚未得到回复**的
     * 用户轮次 —— 沿 parentId 能找到真实 user、user 在边界之前、两者之间没有已完成的
     * assistant 回复。这三个条件沿用原过滤器，是 marker 能成立的因果前提：文案断言
     * 的是"用户打断了上一轮"，若边界挂在一个已经正常回复完的轮次后面（`/insights`
     * 等特殊顺序、恢复流程留下的错位记录），投影出去就是在对模型说假话。
     *
     * 守卫不通过时原样返回该条，交回 `filterApiErrorMessages` 按基线行为剔除，
     * 模型侧语义与改动前完全一致。
     *
     * 不落盘、不改 transcript：UI 继续显示原来那条 assistant 占位。
     */
    static projectCancelledTurnMarker(history: AgentInputItem[]): AgentInputItem[];
    private static findCancelledTurnUserId;
    /**
     * 这一段里是否已经出现过**结束该轮的** assistant 答复。
     *
     * 不能只看"有没有 completed 的 assistant message"：模型调用工具前常先写一句叙述
     * （tool-call carrier，真实 jsonl 里就是 `status: 'completed'` 的独立 message，
     * 见 `history-utils.parallel-tool-calls.spec.ts`）。那句话不是对用户的答复，
     * 这一轮还在继续 —— 所以每遇到一个 `function_call` 就把"已答复"重置掉。
     *
     * 依据的是一轮的结构：assistant message 与 function_call 交替，只有**后面再没有
     * 工具调用**的那条 assistant message 才是对用户的答复。于是三种形态各自判对：
     *   - `user → 答复(completed) → 边界`                 → 已答复，边界错位，不投影
     *   - `user → carrier → call → result → 边界`         → 未答复（工具跑完但还没回答），投影
     *   - `user → carrier → call → result → 答复 → 边界`  → 已答复，边界错位，不投影
     */
    private static hasCompletedAssistantReplyBetween;
    /**
     * 在每次模型请求前应用 content-filter 清理:
     * 上一轮模型响应若以 finish_reason=content_filter 结束,
     * session-manager 会把"被拦那条用户消息的 id"写到
     * `meta.lastContentFilterUserMessageId`。本方法把该消息从
     * `modelData.input` 里删掉,然后清理临时标记,避免下一轮普通请求
     * 因残留标记被误删消息。
     *
     * 副作用契约(调用方需知晓):
     * - 命中拦截 id 时,**会** mutate `meta`(删除两个临时键)
     * - 提供 `logger` 时,会输出一条 info 日志说明剔除了哪个 id
     *
     * @param modelData SDK callModelInputFilter 入参原型
     * @param meta      session.meta 的引用(允许 undefined)
     * @param logger    可选 logger
     * @returns 处理后的 modelData;无需剔除时返回原引用(便于调用方判等)
     */
    static applyContentFilterCleanup(modelData: {
        input: AgentInputItem[];
        instructions?: string;
    }, meta: Record<string, any> | undefined, logger?: Logger): {
        input: AgentInputItem[];
        instructions?: string;
    };
    /**
     * Filter out synthetic assistant messages created from API errors (HTTP 400/500/502/network errors).
     * These messages are kept in local session history for UI display but should not be sent to the model.
     *
     * Identification criteria: role === "assistant" + providerData.skipRun === true + providerData.error exists.
     * FunctionCallResultItem (tool_result) with errors is NOT filtered — those are normal tool feedback.
     */
    static filterApiErrorMessages(history: AgentInputItem[]): AgentInputItem[];
    static filterRenameHistory(history: AgentInputItem[]): AgentInputItem[];
    /**
     * 让 model input 里的 tool_call 与 tool_result 严格一一配对（issue #119545）。
     *
     * 背景：工具结果丢失（状态机吞掉 TOOL_ENDED、持久化缺口、压缩切断）后，历史里会留下
     * 只有 call、没有任何 result 的孤儿。上游对 tool_calls 强制配对，一条孤儿就让整个
     * 请求 400，会话从此不可恢复——而本地历史里的孤儿是持久化的，每次恢复都会重现。
     *
     * 三类都处理，因为上游拒的是"不配对"这件事本身，方向无关：
     * 1. call 没有任何同 callId 的结果项 → 丢 call；
     * 2. 同一 callId 出现多条 call（重放/重试残留）→ 只留最后一条；
     * 3. 结果项的 callId 没有留下来的 call（头部被截断，或 call 属于上面两类）→ 丢结果。
     *
     * 判据只看"存在性"，不看结果的真伪：skipRun 占位/拒绝、partial aborted 等伪结果都算
     * 配对，它们的取舍归 filterTruncatedToolCalls，两者职责不重叠。改写只落在当轮副本上，
     * 因此日志按轮聚合成一条并截断样本。
     */
    static filterUnpairedToolCalls(modelData: {
        input: AgentInputItem[];
        instructions?: string;
    }, logger?: Logger): {
        input: AgentInputItem[];
        instructions?: string;
    };
    static getItemsNeedingFill(history: AgentInputItem[]): FunctionCallItem[];
    static getFillItemsForNeedingFill(itemsNeedingFill: FunctionCallItem[]): FunctionCallResultItem[];
    /**
     * 配对 function_call 与 function_call_result，缺失的 result 用占位补齐。
     *
     * **分组不变式**：同一次模型响应产生的并行 function_call 在历史里是连续的，
     * 它们的 result 必须整体排在这组 call 之后，不能与 call 交替。因为
     * itemsToMessages 一遇到 function_call_result 就给当前 assistant 消息封口，
     * 交替顺序会把一条带 N 个 tool_calls 的 assistant 拆成 N 条各带 1 个的消息，
     * 同时让 SDK 补丁挂在每个 call 上的 thinking 文本被复制 N 份（Issue #114622）。
     * 因此 result 先进 pendingResults 暂存，遇到任何非 function_call 的项（即这组
     * 并行调用结束）才一次性 flush。对 call/result 齐全且顺序正常的历史，这是恒等变换。
     *
     * 注意：`providerData.discard` 在这里**只对 message 生效**（下面第二个循环）。
     * function_call 不按 discard 过滤是刻意的——参数非法的 call 由
     * RunnerFactoryImpl.filterTruncatedToolCalls 统一处置（可修复的就地改写、已有真实
     * 反馈的保留、其余才删除）。若在此处按 discard 把 call 剔掉，会连同 SDK 产出的
     * parse-error 反馈一起从模型输入里消失，模型看不到自己错在哪只能原样重试。
     */
    static fillFunctionCallResultHistory(history: AgentInputItem[]): AgentInputItem[];
    /**
     * 剥离所有工具调用相关消息（function_call / function_call_result），只保留
     * 纯对话内容（user / assistant message、reasoning 等）。
     *
     * 用于 `disableTools` 场景（如 /btw 侧问题）：此时子 agent 的 `tools` 被清空，
     * 但从父 session 继承来的 history 仍可能带 function_call / function_call_result。
     * 若把「有工具调用消息 + 无工具定义」的请求发给模型推理网关，会触发参数校验
     * 失败返回 `400 invalid parameter value`（见 Issue #62037）。既然子请求不允许
     * 用工具，这些工具交互消息对回答侧问题也无意义，直接剥离即可让请求体自洽。
     *
     * 同时丢弃剥离后 content 变空的 assistant message（原本只承载 tool_call、无文本
     * 的那一轮），避免给模型送一条空的 assistant 消息。
     */
    static stripToolCallHistory(history: AgentInputItem[]): AgentInputItem[];
    /**
     * Brief 模式（issue #82025）扁平 history 去重：丢弃"调用了 SendUserMessage 的 turn 内的 assistant 文本"。
     *
     * 与 TUI 侧 `use-message-groups` 的 `dropTextGroupsInBriefTurns` 语义一致，但操作扁平的
     * `AgentInputItem[]`（session.history），供 print / headless 文本输出路径使用——TUI 归组结构与
     * 扁平 history 无法无损互转，故两侧各持一份等价实现（共享同一 turn 语义与工具名）。
     *
     * 防误伤：brief 关闭时原样返回；未调用 SendUserMessage 的 turn 文本保留。
     */
    static dropAssistantTextInBriefTurns(history: AgentInputItem[], briefEnabled: boolean): AgentInputItem[];
    /**
     * Brief 模式（issue #82025）：提取最后一个 turn 内 SendUserMessage 的 message 内容（正式回复）。
     *
     * print / headless 文本输出的首选——brief 下正式回复走 SendUserMessage，其后的 assistant 文本是
     * 冗余工作笔记。取不到时返回空串（由调用方 fallback）。
     *
     * 优先级：
     *   function_call_result.providerData.toolResult.renderer.value（markdown）
     *   → function_call_result.providerData.toolResult.rawResponse.message
     *   → function_call.arguments.message（JSON 解析）
     */
    static extractLastSendUserMessageText(history: AgentInputItem[]): string;
}
//# sourceMappingURL=history-utils.d.ts.map