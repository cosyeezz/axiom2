import { Session } from '../../vendor/cbc-core/node/index.js';
import { AgentInputItem, RunResult, StreamedRunResult } from '../../vendor/cbc-shared/node/index.js';
/**
 * 从 ACP `PromptRequest.prompt` 中提取的资料库 / 知识库 mention 信息，
 * 用于填充服务端 `chat_request_send` 埋点的 `mentionContexts` / `knowledgeId` / `knowledgeName`。
 *
 * 由 ACP 入口在调用 `promptToUserMessage` 之前/之后写入 `session.meta.pendingMentionInfo`，
 * 由 TelemetryAgentRunInterceptor 在构建 `session.telemetry` 时读出，
 * 由 TelemetryService 在 `reportChatRequestSendTelemetry` 中输出到 telemetry payload。
 *
 * Issue #134500：mentionContexts 结构升级为 KV 字符串数组（示例 `['file:2','rule:1']`），同类计数合并；
 * `mentionContextCount` = 所有 count 之和（由 TelemetryService 组装时按 `:` 后数字累加）。
 */
export interface PendingMentionInfo {
    mentionContexts: string[];
    knowledgeId: string[];
    knowledgeName: string[];
}
export interface PendingSkillRecommendSend {
    inputAttemptId?: string;
    recommendId: string;
    skillId: string;
    expertId: string;
    connectorId?: string;
}
export declare abstract class TelemetryUtils {
    /**
     * 获取输入内容长度
     */
    static getInputLength(input: string | AgentInputItem[] | any): number;
    static getInputLengthFromItem(item: AgentInputItem): number;
    /**
     * 获取输入类型
     */
    static getInputType(input: string | AgentInputItem[] | any): string;
    /**
     * 计算实际轮次数
     */
    static calculateActualTurns(session: Session): number;
    /**
     * 统计本轮请求（session.conversationRequestId）的工具调用次数。
     *
     * 口径与 `chat_tool_action` 对齐：每条 function_call_result 计一次，且只计归属本轮
     * requestId 的条目。session.history 是 resume 尾部窗口 + compact 裁剪后的内存视图，
     * 全量计数既不是本轮也不是会话累计（#150430）。
     * 缺 requestId 时回退到最近一条 user 消息之后的条目。
     */
    static countToolCalls(session: Session): number;
    /**
     * 判断执行是否成功
     */
    static isExecutionSuccessful(result: RunResult<any, any> | StreamedRunResult<any, any> | undefined, error?: any): boolean;
    /**
     * 获取模型信息
     * 当 agent.model 为字符串时，通过 AgentManager.resolveModel 反查 product.json
     * 中对应的 displayName 作为 modelName；反查失败则 fallback 到 modelId 本身。
     */
    static getModelInfo(agent: any): Promise<{
        modelId: string;
        modelName: string;
    }>;
    /**
     * 获取错误信息
     */
    static getErrorInfo(error: any): {
        errorCode?: string;
        errorMessage?: string;
    };
    /**
     * 从 ACP `PromptRequest.prompt` 块数组中提取 mention 信息。
     *
     * Issue #134500 对齐规则：
     * - **mentionContexts 单一数据源 = `_meta['codebuddy.ai'].mentionContexts`**（WB 侧
     *   `collectMentionContextsFromBlocks` 已在 UI 层按 Issue 口径聚合完成）。CLI 侧看到
     *   该字段非空就只信它，不再遍历 prompt blocks 二次计数，避免重复：wire 层会把
     *   `image` block 原样透传，若 CLI 侧再按 `_meta.mentionType` 累计一次，`file` / `image`
     *   都会被多算（现网 `file:3` 的直接根因）。
     * - WB 没写 mentionContexts 时（兼容 CLI print / 旧 WB 版本）才回退到遍历 blocks。
     * - 知识库 id / name 始终从 blocks 提取（WB 没在 `_meta['codebuddy.ai']` 里塞 id/name），
     *   与 counter 独立。
     * - 知识库 3 子类按来源拆（WB 没写时的回退路径）：
     *   - IMA（`_meta.source === 'ima'`）→ `knowledge_ima`
     *   - 腾讯文档（`mentionType === 'tencent-doc'`）→ `knowledge_tdoc`
     *   - 腾讯乐享（`mentionType === 'tencent-lexiang'`）→ `knowledge_lx`
     *
     * promptBlocks 通常来自 `request.prompt`（ACP `PromptRequest`），可以是任意类型——
     * 安全做法：只读已知字段，不依赖具体 schema，未匹配上的块直接忽略。
     */
    static extractMentionInfoFromPrompt(promptBlocks: unknown, requestMeta?: unknown): PendingMentionInfo;
    /**
     * WB 侧已有 `mentionType` → Issue #134500 文档 token。无对应 token 返回 undefined（忽略，不生造）。
     *
     * 知识库命名空间（knowledge_*）：
     * - `knowledge_ima` / `knowledge_tdoc` / `knowledge_lx`：由主流程特判分支处理（含 knowledge id / name 提取）
     * - `knowledge_space`：资料库 / 空间文档，主流程特判（含 id / name 提取）
     * - `knowledge_wecom_online_doc` / `knowledge_wecom_wedrive`：企微在线文档 / 企微微盘，主流程特判
     *
     * `link` 只兜底"外部纯链接"类（如云代码仓库 `cloudRepo`）。
     */
    private static mapMentionTypeToToken;
    /**
     * 知识库 id 兜底顺序（根据 WB 侧 chip 建块路径实际字段整理，Issue #134500 诊断日志对账得出）：
     *
     *   ima.kbId → kbId → fileId → ima.fileId → docId → entityId → resourceId
     *     → fileUrl → url → block.uri
     *
     * - ima：`ima.kbId / ima.fileId`（ima chip）
     * - lexiang：`kbId / entityId`
     * - tencent-doc / space-doc：`docId / fileId / entityId`
     * - 企微在线文档 / 企微微盘：**无结构化 id 字段**，兜底使用 `fileUrl` / `url` / `block.uri`
     *
     * 全部命中失败时返回空串（调用方按 1:1 规则用空串占位）。
     */
    private static resolveKnowledgeId;
    /**
     * 知识库 name 兜底顺序：
     *   ima.kbName → kbName → fileName → filename → title → displayText → block.name
     * 全部命中失败时返回空串（调用方按 1:1 规则用空串占位）。
     */
    private static resolveKnowledgeName;
    private static serializeMentionCounter;
    private static extractMentionContextsFromRequestMeta;
    static extractSkillRecommendSendFromPrompt(promptBlocks: unknown, requestMeta?: unknown): PendingSkillRecommendSend | undefined;
    private static readTopLevelSkillId;
    private static readCodebuddySkillRecommend;
    private static readSkillRecommendSend;
}
