import { AgentManager, AgentRunInterceptor, AgentRunInterceptorPriority, AgentRunRequest, PromptRenderer, SessionHookManager } from '../../../vendor/cbc-core/node/index.js';
import { Command, ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import { CustomCommandRenderer, McpPromptRenderer } from '../../command';
import { SettingsManager } from '../../settings/settings-protocol';
export declare class AgentSwitchAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly agentManager: AgentManager;
    protected readonly productManager: ProductManager;
    protected readonly settingsManager: SettingsManager;
    protected readonly promptRenderer: PromptRenderer;
    protected readonly customCommandRenderer: CustomCommandRenderer;
    protected readonly mcpPromptRenderer: McpPromptRenderer;
    protected readonly logger: Logger;
    protected readonly sessionHookManager: SessionHookManager;
    intercept(request: AgentRunRequest): Promise<void>;
    /**
     * `/compact` 直接路由到 compact agent，不经过 ContextCompactSummarizer，
     * 因此需要在这里单独触发 PreCompact。内部压缩回灌消息带有
     * isCompactInternal，必须跳过以避免重复触发。
     */
    protected executeManualPreCompactHooks(request: AgentRunRequest): Promise<void>;
    /**
     * 从输入中提取命令名（不含 / 前缀）。
     * 支持从 <channel> 标签包裹的文本中提取斜杠命令。
     */
    private extractInputCommandName;
    /**
     * `command_source` 取值对齐 Claude Code 官方枚举（'plugin' | 'user' | 'project' | 'mcp'）：
     * plugin 命令按 tag 识别，MCP prompt 命令固定 'mcp'，剩下的自定义/Workflow 命令
     * 用 `Command.scope`（'user' | 'project'）。内置命令没有 scope，留空。
     */
    protected resolveCommandSource(command: Command): string | undefined;
    /**
     * UserPromptExpansion（Claude Code 官方事件）通用阻断入口：命令/skill 展开成
     * prompt、送进模型之前统一从这里触发一次 hook，可被阻断。命令展开与 skill
     * 展开共用同一个入口，不因调用方（如统一资产门控）而有特殊路径。
     *
     * 阻断时负责把提示追加进 input 并置 skipRun；调用方只需要在返回 true 时停止
     * 继续渲染/展开当前这条命令。
     */
    protected guardPromptExpansion(request: AgentRunRequest, payload: {
        expansionType: 'slash_command' | 'mcp_prompt';
        commandName: string;
        commandArgs: string;
        commandSource?: string;
        prompt: string;
    }, fallbackMessage?: string): Promise<boolean>;
    protected resolveAgent<TAgent>(command: Command): Promise<TAgent | undefined>;
    protected handleCommands(request: AgentRunRequest, commands: Command[]): Promise<Command | undefined>;
    protected safeRender(promptToRender: string, ctx?: Record<string, any>): Promise<string>;
    protected isCompactCommand(command: Command): boolean;
    protected isCommand(text: string, command: Command): boolean;
    /**
     * 构建命令上下文标签（统一格式）
     * 用于 MCP prompt 和 custom command，确保两者拼接给模型的格式一致
     * @param commandName 命令名称（如 /review-pr 或 /mcp__server__prompt）
     * @param fullInput 完整输入（包含命令名和参数）
     * @returns 格式化的标签字符串
     */
    protected buildCommandContextTags(commandName: string, fullInput: string): string;
    /**
     * Extract the command text from a message, unwrapping any envelope the client
     * put around it. For plain text, returns the trimmed text.
     */
    private extractCommandText;
    /**
     * 拆开客户端加在命令文本外面的包裹，并保留改写后要还原的隐藏上下文。
     *
     * 支持两种形态：
     * - `<channel source="...">/cmd</channel>`（多频道事件）；
     * - `<system-reminder …>…</system-reminder>\n<user_query>/cmd</user_query>`
     *   （WorkBuddy / IDE 客户端发送前就拼好的形态，见 HIDDEN_CONTEXT_USER_QUERY_RE）。
     */
    private parseCommandEnvelope;
    /**
     * 把隐藏上下文放回改写结果前面。
     *
     * 不重新套 `<user_query>`：TUI 路径下展开产物同样是裸的
     * `<command-message>…`（`UserQueryWrapperAgentRunInterceptor` 认它是系统注入内容
     * 而跳过包裹），这里保持一致，避免两条链路给模型的形状不同。
     */
    private restoreHiddenContext;
    /**
     * 处理 skill 的斜杠命令调用
     * 当用户显式输入 /skill-name 且未匹配到 command 时，尝试在 skills 中查找
     * 找到后将用户输入替换为 skill 指令内容，使 LLM 直接执行 skill
     */
    protected handleSkillSlashCommand(request: AgentRunRequest): Promise<boolean>;
}
