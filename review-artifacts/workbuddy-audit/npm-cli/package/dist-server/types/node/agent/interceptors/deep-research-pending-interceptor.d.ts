/**
 * DeepResearchPendingInterceptor —— 当 session 处于"已触发 /deep-research 但 Workflow 工具尚未调"
 * 状态时,每轮在 user input 末尾注入一段加强 reminder,降低主 agent "澄清几轮就忘了调工具"的概率。
 *
 * 单一职责:扫 history → 判断 pending 状态 → 注入 reminder。
 *
 * Pending 判断:
 *   - history 里有 user 消息含 `data-role="deep-research-trigger"` reminder
 *   - 且 history 里**没有** Workflow 工具的 function_call (`name === ToolNames.WORKFLOW`)
 *   两者同时成立 → pending → 注入。
 *
 * 一旦 Workflow 工具被调,pending 就解除,后续轮次不再注入。
 *
 * 优先级:与 keyword/effort 同档(SystemReminderContext - 35),先后无所谓。
 */
import { PromptManager } from '@genie/prompts';
import { AgentRunInterceptor, AgentRunRequest } from '../../../vendor/cbc-core/node/index.js';
import type { AgentInputItem } from '../../../vendor/cbc-shared/node/index.js';
export declare class DeepResearchPendingInterceptor implements AgentRunInterceptor {
    priority: number;
    protected readonly promptManager: PromptManager;
    intercept(request: AgentRunRequest): Promise<void>;
    /**
     * Visible-for-testing:扫 history 判定是否处于"已触发但未调工具"状态。
     */
    isPending(history: ReadonlyArray<AgentInputItem>): boolean;
    private isWorkflowToolCall;
    private containsDeepResearchTrigger;
    private loadReminder;
}
