import { type Session } from '../../vendor/cbc-core/node/index.js';
import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { AgentTaskManager, AgentTaskOutputFileManager } from '../agent-task/agent-task-protocol';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const TaskOutputParameters: z.ZodEffects<z.ZodObject<{
    task_id: z.ZodString;
    block: z.ZodOptional<z.ZodBoolean>;
    timeout: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    filter: z.ZodOptional<z.ZodString>;
    full: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    timeout: number;
    task_id: string;
    filter?: string | undefined;
    block?: boolean | undefined;
    full?: boolean | undefined;
}, {
    task_id: string;
    timeout?: number | undefined;
    filter?: string | undefined;
    block?: boolean | undefined;
    full?: boolean | undefined;
}>, {
    timeout: number;
    task_id: string;
    filter?: string | undefined;
    block?: boolean | undefined;
    full?: boolean | undefined;
}, {
    task_id: string;
    timeout?: number | undefined;
    filter?: string | undefined;
    block?: boolean | undefined;
    full?: boolean | undefined;
}>;
export declare class TaskOutputTool extends BaseTool implements Tool {
    protected readonly agentTaskManager: AgentTaskManager;
    protected readonly taskOutputFileManager: AgentTaskOutputFileManager;
    protected readonly logger: Logger;
    name: ToolNames;
    isConcurrencySafe(): boolean;
    description: string;
    aliases: string[];
    needsApproval: boolean;
    parameters: z.ZodEffects<z.ZodObject<{
        task_id: z.ZodString;
        block: z.ZodOptional<z.ZodBoolean>;
        timeout: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
        filter: z.ZodOptional<z.ZodString>;
        full: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        timeout: number;
        task_id: string;
        filter?: string | undefined;
        block?: boolean | undefined;
        full?: boolean | undefined;
    }, {
        task_id: string;
        timeout?: number | undefined;
        filter?: string | undefined;
        block?: boolean | undefined;
        full?: boolean | undefined;
    }>, {
        timeout: number;
        task_id: string;
        filter?: string | undefined;
        block?: boolean | undefined;
        full?: boolean | undefined;
    }, {
        task_id: string;
        timeout?: number | undefined;
        filter?: string | undefined;
        block?: boolean | undefined;
        full?: boolean | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    execute(input: z.infer<typeof TaskOutputParameters>, context?: RunContext<Session>): Promise<ToolResult>;
    private executeDurableTeamRuntimeTask;
    /**
     * Workflow 后台任务的 output 渲染。
     *
     * Workflow 跑完后由 WorkflowTool 在 finalizeBackgroundTask 里把 record.output
     * 落盘到 task.outputFilePath。这里直接读文件,
     * 失败时给出明确提示。仍在运行的 workflow 给 hint 让模型不要轮询。
     */
    /** Agent 子任务进度游标：每任务上次投喂到的绝对偏移（终态清账）。 */
    private readonly progressOffsets;
    /**
     * BackgroundTask 的模型读取游标。WeakMap 让游标随 ToolManager 中的任务对象一起回收，
     * stdout / stderr 独立推进；不清空共享 buffer，UI 与 full snapshot 仍可读取累计内容。
     */
    private readonly shellReadCursors;
    /**
     * 运行中进度增量。语义对齐 claude 2.1.235 的 TaskOutput（SIn +
     * getTaskOutputDelta，二进制实测）：running 态回退读任务输出、字节截尾 +
     * `[NKB of earlier output omitted]` 前缀、缺席回空；增量游标使重复轮询
     * 只回新增（上下文）+ 写透尾环命中零文件读（remote fs）。
     */
    private readProgressDelta;
    /**
     * 游标写入带容量上限：终态渲染才清账（见 execute 尾部 delete），从未被
     * 轮询到终态的任务（abort/杀死后不再查询）会永久滞留——长驻 server
     * 累积子代理任务时是无界泄漏。超限逐出最早插入项（Map 迭代序），
     * 被逐出任务若再被轮询按 firstPoll 语义从头投喂，语义无损。
     */
    private static readonly PROGRESS_OFFSET_CAP;
    private rememberProgressOffset;
    private executeWorkflowTask;
    /**
     * Handle agent sub-task output (original TaskOutputTool behavior)
     */
    private executeAgentTask;
    private buildAgentTaskOutputLines;
    private renderAgentTaskSnapshot;
    /**
     * Handle background shell task output (merged from BashOutputTool)
     *
     * 当 `block=true`（默认）且任务仍在运行时，先 await 到任务终态（或 timeout）再渲染
     * 输出——对齐 agent-task 的 `waitFor` 语义。历史实现无视 block/timeout 直接返回当前
     * buffer + "still running" hint，导致模型收到 block 请求后立刻拿到"仍在运行"，
     * 于是反复重试 TaskOutput 形成紧密轮询死循环（#issue：CBC 一直 loop 发送
     * "I'll wait for the completion notification"）。真正 block 住后模型每轮最多一次调用，
     * 死循环消失。
     */
    private executeBackgroundShellTask;
    private acknowledgeBackgroundResult;
    /**
     * 等待后台 shell 任务到达终态（completed/failed/cancelled/killed），或 timeout / abort。
     *
     * 优先订阅 `session.backgroundTaskSubject`（bash-tool 在 status 变更时 `.next(task)`），
     * 事件驱动、无空转。拿不到 session（如某些非交互路径）时降级为轮询 task.status。
     * 无论哪条路径退出，都不改写 task —— 仅"等待"，渲染逻辑照旧读 task 当前快照。
     *
     * timeout 语义与 agent-task waitFor 对齐：到点即返回（此时 status 可能仍是 running，
     * 由调用方渲染 running 快照 + hint）。abort（用户 Ctrl+C）同样立即返回。
     */
    private waitForShellTerminal;
    private formatDuration;
}
export {};
