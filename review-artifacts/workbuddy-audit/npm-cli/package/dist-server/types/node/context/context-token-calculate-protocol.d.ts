import { AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
import { Session } from '../../vendor/cbc-core/node/index.js';
export declare const ContextTokenCalculateService: unique symbol;
/**
 * 自定义Agent信息
 */
export interface CustomAgentInfo {
    name: string;
    source?: string;
    tokens: number;
}
/**
 * Memory文件信息
 */
export interface MemoryFileInfo {
    type: string;
    filePath: string;
    tokens: number;
}
/**
 * MCP工具信息
 */
export interface McpToolInfo {
    /** 工具名称 */
    name: string;
    /** 所属服务器名称 */
    serverName: string;
    /** token数量 */
    tokens: number;
}
/**
 * Skill 或 SlashCommand 信息
 */
export interface SkillAndCommandInfo {
    /** 名称 */
    name: string;
    /** 类型: skill 或 command */
    type: 'skill' | 'command';
    /** 来源/作用域: project, user, 或 plugin 名称 */
    scope: string;
    /** token数量 */
    tokens: number;
}
/**
 * Session Token 分布详情
 */
export interface SessionTokenBreakdown {
    modelId: string;
    /** system消息的token数 */
    systemPrompt: number;
    /** 其他消息的token数 */
    messages: number;
    /** tools定义的token数 */
    tools: number;
    /**
     * 不相交分项估算之和：system + messages + tools + memoryFiles + mcpTools。
     * customAgents / skillsAndCommands 只作明细（已含在 tools schema 里）。
     * 丢失 chat-template 框架 token，**不是**真实占用，顶行用 `realInputTokens`。
     */
    total: number;
    /**
     * 上一次真实 LLM 调用返回的 inputTokens，与状态栏 `Context tokens: X%` 同源，
     * 是权威用量。会话尚未发生真实调用时为 undefined，调用方应回退到 `total`
     * 并标注为估算。
     */
    realInputTokens?: number;
    /** 模型最大token限制 */
    maxTokens?: number;
    /** 自定义agents */
    customAgents?: CustomAgentInfo[];
    /** memory文件 */
    memoryFiles?: MemoryFileInfo[];
    /** MCP工具 */
    mcpTools?: McpToolInfo[];
    /** Skills 和 SlashCommands 详细列表 */
    skillsAndCommands?: SkillAndCommandInfo[];
    /** 自动压缩缓冲区token数 */
    autocompactBuffer: number;
    /** 自动压缩是否启用 */
    autocompactEnabled: boolean;
}
/**
 * `/context` 用的上下文 token 估算服务。
 */
export interface ContextTokenCalculateService {
    /**
     * 粗估消息列表 token 数（本地，不发模型请求）。
     */
    calculate(messages: AgentInputItem[], modelId: string): Promise<number>;
    /**
     * 计算 Session 的 token 分布。拦截 agent 请求体后本地估算；
     * 不发 `maxTokens:1` dry-run。customAgents / skills 只作明细。
     *
     * 仅供 `/context` 命令使用；不参与 compact 路径的 ACP `usage_update` 推送。
     *
     * 副作用：
     * - 临时改写 `session.meta` 注入 token 计算拦截标记，try/finally 中还原；
     * - 假 run 可能改写 abort 句柄；finally 仅在仍是该诊断 controller 时还原。
     *
     * @param session 会话对象
     * @param modelId 可选模型 ID；缺省时从拦截到的 agent 上下文中推导。
     * @returns Promise<token 分布详情>
     */
    calculateSession(session: Session, modelId?: string): Promise<SessionTokenBreakdown | undefined>;
}
