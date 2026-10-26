/**
 * UltracodeKeywordInterceptor —— 识别用户输入里的 `ultracode` / "use a workflow" 关键词,
 * 注入 system-reminder 提示主 agent 优先用 Workflow 工具。
 *
 * 单一职责:Trigger 路由层。本拦截器只负责"提示",不负责真正起 workflow —— 那是 Agent 调用 Workflow 工具的事。
 *
 * 优先级:位于 SystemReminderContext(1200) 之后,MessageReorganize(1300) 之前。
 * 与 ChannelEvent 同档(1170 → 这里 1165),时间维度上稍后,以避免覆盖 channel 事件。
 *
 * 触发规则(对齐深度文档):
 * - 用户输入文本里包含独立 token `ultracode`(不在 ` `/`"`/字符串里) → 注入 reminder
 * - 用户输入文本里出现 "use a workflow" / "run a workflow" / "use workflow" 等自然短语 → 注入
 *
 * 注入内容:一段 system-reminder,告知主 agent 当前请求适合用 Workflow 工具(opt-in 已满足)。
 */
import { PromptManager } from '@genie/prompts';
import { Logger } from '@genie/telemetry';
import { AgentRunInterceptor, AgentRunRequest } from '../../../vendor/cbc-core/node/index.js';
export declare class UltracodeKeywordInterceptor implements AgentRunInterceptor {
    /** 比 ChannelEvent(1170)略低,确保不破坏 channel 事件结构 */
    priority: number;
    protected readonly logger: Logger;
    protected readonly promptManager: PromptManager;
    intercept(request: AgentRunRequest): Promise<void>;
    private loadReminder;
    /**
     * 抽取用户消息文本(忽略 system-reminder / tool-hint 等内部消息)。
     * 简单实现:最后一条 role='user' 的消息;只看 string 内容。
     */
    private extractUserText;
    /** 排除完全由 system-reminder/tool-hint 包裹、无真实用户输入的消息。 */
    private looksLikeUserText;
    private isUltracodeRequest;
}
