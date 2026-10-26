import { AgentRunInterceptor, AgentRunInterceptorPriority, AgentRunRequest } from '../../../vendor/cbc-core/node/index.js';
import { PromptManager } from '@genie/prompts';
import { Logger } from '@genie/telemetry';
import { ChannelManager } from '../../channel';
import { IDEService } from '../../ide-integration/ide-protocol';
import { MemoryManager } from '../../memory';
import { PlanStorageService } from '../../tools/plan-storage-service';
export declare class SystemReminderAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    private readonly hostContexts;
    protected readonly promptManager: PromptManager;
    protected readonly memoryManager: MemoryManager;
    protected readonly ideService: IDEService;
    protected readonly channelManager: ChannelManager;
    protected readonly planStorageService: PlanStorageService;
    protected readonly logger: Logger;
    intercept(request: AgentRunRequest): Promise<void>;
    /**
     * Route a named system-prompt section through the mods `prompt.section`
     * middleware event. Contract mirrors upstream Claude Code:
     *
     *   - `text: null` returned by a mod drops the section (returns undefined,
     *     caller must not inject anything);
     *   - `text: string` returned by a mod replaces the section body;
     *   - `deny: string` drops the section (same as null);
     *   - no hook match returns the input text unchanged.
     *
     * `undefined` inputs (no section body from cbc) pass a `null` text to the
     * mod so a mod can *add* the section if it wants (upstream: `prompt.section`
     * with `text: null` means "cbc has no content for this section, feel free
     * to synthesise one").
     */
    private applyPromptSection;
    /**
     * 生成 Channel Instructions
     * 从所有已注册的 channel 服务器收集 instructions 并注入
     *
     * **必须用 `<system-reminder>` 标签包裹**：addSystemReminder 直接把传入字符串
     * unshift 到 user message 的 content 数组，前端 user-message-box.tsx 通过
     * `stripSystemReminders` 剥离 `<system-reminder>...</system-reminder>` 内的
     * 内容才能避免把它当真实 user 输入渲染。如果返回裸字符串（无标签），
     * webui 会把整段 `Messages from WeChat arrive as ...` 长 instructions
     * 渲染成用户气泡，并被 topic generator 误当作首条消息生成会话标题。
     */
    private generateChannelInstructions;
    private isFirstOrResumeMessage;
    /**
     * 检查是否需要注入系统规则/记忆
     * 在以下情况下需要注入：
     * 1. 首条消息
     * 2. 恢复会话
     * 3. 当前历史不包含 system-reminder（压缩后或恢复后的场景）
     */
    private shouldInjectSystemReminder;
    /**
     * 检查历史消息中是否包含真正的系统规则 system-reminder 标签
     * 区分两种类型的 system-reminder：
     * 1. 规则型（CODEBUDDY.md 规则 / 条件规则）：不带 data-role 属性
     * 2. 非规则型：带 data-role 属性（如 compact-summary, command-caveat, memory,
     *    hook, ide-context, channel-event, team-context, error-recovery, tool-hint,
     *    message-queue, memory-freshness 等），应该忽略
     */
    private historyContainsSystemReminder;
    /**
     * 检查文本中是否包含规则型 system-reminder
     * 排除带 data-role 属性的非规则型 system-reminder
     */
    private hasRulesSystemReminder;
    private isUserMessage;
    /**
     * 检查是否为 isMeta 消息（Stop Hook 自动触发的内部消息）
     * 这些消息应该保持简洁，不添加额外的 system-reminder
     */
    private isMetaMessage;
    private injectHostContext;
    private renderSystemReminder;
    private generateSystemReminder;
    /**
     * 极简模式没有 Plan 循环：会话若因切模式前的遗留状态停在 Plan，就把权限模式
     * 收回去，否则模型会拿着一个永远无法 ExitPlanMode 的会话空转。
     *
     * 独立成显式命名的方法而不是塞在 `generatePlanModeReminder` 里 —— 那是个
     * `generate*` 取值函数，在里面改 `permissionModeSubject` 是隐藏副作用。
     * 只按 agent 名门控，WorkBuddy 默认 cli 不会进这条。
     */
    private enforceMinimalPermissionMode;
    private generatePlanModeReminder;
    private generateDelegateModeReminder;
    private generateIDESelectionReminder;
    /**
     * Inject hook-provided contexts into user messages
     * Implements Claude Code hooks specification for additionalContext injection
     */
    private injectHookContexts;
    /**
     * Route a hook-produced attachment text through the mods `prompt.attachment`
     * middleware event. Contract mirrors upstream: `{ text }` rewrites, `{ text: null }`
     * or `{ deny }` drops the attachment, no hook returns the input unchanged.
     */
    private applyPromptAttachment;
}
