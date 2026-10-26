/**
 * UltracodeEffortReminderInterceptor —— 当 session 处于 effort=ultracode 模式时,
 * 每轮在 input 末尾注入一段 `ultra_effort_active` reminder,提示主 agent
 * 默认就用 Workflow 工具规划任务。
 *
 * 单一职责:在 ultracode 模式下持续注入"模式提醒"。enter/exit 事件由 EffortCommandExecutor 自己注入。
 *
 * 状态读取:`session.meta.workflowEffortLevel === 'ultracode'`(EffortCommandExecutor 维护)。
 *
 * 优先级:与 KeywordInterceptor 相同档(SystemReminderContext-35),先后顺序无所谓。
 *
 * Reminder 文本:从 prompt template `workflow-ultra-effort-active` 加载;打包/配置异常时走 FALLBACK。
 */
import { PromptManager } from '@genie/prompts';
import { AgentRunInterceptor, AgentRunRequest } from '../../../vendor/cbc-core/node/index.js';
export declare class UltracodeEffortReminderInterceptor implements AgentRunInterceptor {
    priority: number;
    protected readonly promptManager: PromptManager;
    intercept(request: AgentRunRequest): Promise<void>;
    private loadReminder;
}
