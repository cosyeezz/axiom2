/**
 * WorkflowTool —— 把 Dynamic Workflow 暴露给 LLM 主 agent 的 Tool 入口。
 *
 * 单一职责:协议适配。校验 input → 转交 WorkflowManager.start() → **立刻**返回 runId,
 * 不阻塞主对话。workflow 在后台跑,主 agent 可以继续做其他事。
 *
 * 设计取舍(对齐 Claude Code 的 async_launched 行为,见反编译 `wf_full.txt:251499`):
 * - cc 的 Workflow tool 是 fire-and-forget:`(async () => { ... })().catch(...)` 后立刻
 *   `return { data: { status: "async_launched", ... } }`。我们对齐这个语义。
 * - **Sub-agent 静音**:adapter 用 detached:true,不刷屏到主对话区;用户在 status-line /
 *   `/workflows` panel 看实时进度。
 * - **后台任务复用**:workflow run 当成一个 BackgroundTask 注册到 ToolManager,
 *   完成时复用 BackgroundTaskNotifier 推 `<task-notification>` 给主 agent
 *   (与 bash run_in_background / PowerShell 后台任务共用同一通知通道)。
 *   `<output-file>` 落盘到用户隔离临时目录的 `agent-tasks/<runId>.output`,模型用
 *   TaskOutput 工具拉完整结果。
 *
 * 使用约定(opt-in,见 description):
 * - 主 agent 默认不调用此工具。
 * - 仅在用户明确说 "use a workflow"、"run a workflow"、或在 prompt 中写
 *   `ultracode` 关键词、或调用一个已保存的 workflow 命令时才用。
 * - 用户日常请求(单轮可解、不需要多 agent 并行)不要起 workflow。
 */
import { Session } from '../../vendor/cbc-core/node/index.js';
import { type Agent, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { type WorkflowManager, type WorkflowToolInput } from '@genie/cbc-workflow';
import { type ICwdService } from '@genie/cbc-worktree';
import { Logger } from '@genie/telemetry';
import { type FunctionCallItem, type RunContext } from '@openai/agents';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
import { WorkflowBackgroundTaskTracker } from './workflow-background-task';
export declare class WorkflowTool extends BaseTool implements Tool {
    protected readonly logger: Logger;
    protected readonly manager: WorkflowManager;
    protected readonly cwdService: ICwdService;
    protected readonly workflowBackgroundTaskTracker: WorkflowBackgroundTaskTracker;
    name: ToolNames;
    /**
     * 真正的描述来自 product.tools[].description (=> 模板 `workflow-tool-description`),
     * 由框架在工具装配时通过 PromptManager 解出来覆写 BaseTool.description。
     * 这里的占位仅在 product 配置里没声明该工具时兜底。
     */
    description: string;
    parameters: z.ZodObject<{
        script: z.ZodOptional<z.ZodString>;
        scriptPath: z.ZodOptional<z.ZodString>;
        name: z.ZodOptional<z.ZodString>;
        args: z.ZodOptional<z.ZodString>;
        resumeFromRunId: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        name?: string | undefined;
        args?: string | undefined;
        script?: string | undefined;
        scriptPath?: string | undefined;
        resumeFromRunId?: string | undefined;
    }, {
        name?: string | undefined;
        args?: string | undefined;
        script?: string | undefined;
        scriptPath?: string | undefined;
        resumeFromRunId?: string | undefined;
    }>;
    /**
     * 工具卡片的标题:`Workflow(<source>)`,对齐 Claude TUI 截图。
     * <source> 优先级 = name > scriptPath > "dynamic workflow"
     */
    argumentRenderer: ToolCallArgumentRenderer;
    needsApproval: boolean;
    /**
     * 总开关:env 或 settings 任一标记禁用时,本工具就不会被装配进 agent 工具集,
     * LLM 看不到也调不到。对齐 CC 的 `disableWorkflows` 能力。
     * 实现细节:见 workflow/workflow-disabled.ts。
     */
    isEnabled: (_args: {
        runContext: RunContext<Session>;
        agent: Agent;
    }) => Promise<boolean>;
    execute(input: WorkflowToolInput, context?: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
}
