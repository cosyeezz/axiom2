import { AgentManager, InterruptionService, Session } from '../../vendor/cbc-core/node/index.js';
import { GoalService } from '@genie/cbc-goal';
import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { AgentTaskManager } from '../agent-task/agent-task-protocol';
import { BaseTool } from './base-tool';
import { Tool, ToolResult } from './tool-protocol';
declare const ListAgentsParameters: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
export declare class ListAgentsTool extends BaseTool implements Tool {
    protected readonly agentManager: AgentManager;
    name: ToolNames;
    isConcurrencySafe(): boolean;
    description: string;
    parameters: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
    needsApproval: boolean;
    execute(_input: z.infer<typeof ListAgentsParameters>, context?: RunContext<Session>): Promise<ToolResult>;
}
declare const InterruptAgentParameters: z.ZodObject<{
    sessionId: z.ZodString;
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    reason?: string | undefined;
}, {
    sessionId: string;
    reason?: string | undefined;
}>;
export declare class InterruptAgentTool extends BaseTool implements Tool {
    /**
     * 必须走 AgentTaskManager（与 TaskStop 同一条路）取消**活跃**任务。
     *
     * 不要用 `sessionManager.get(id)` 拿目标再 abort —— SessionStore 无活跃缓存，
     * get() 从磁盘反序列化出一个**全新** Session（sessionFactory 无条件 new
     * AbortController），abort 打在废弃副本上，对真正在跑的 run 是空操作；
     * `cancelAllForSession(子会话id)` 也查不到以主会话 id 为键的审批队列。
     * AgentTask.cancel() 持有活的 subAgentSession 引用，abort 才真正生效。
     */
    protected readonly agentTaskManager: AgentTaskManager;
    protected readonly interruptionService: InterruptionService;
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{
        sessionId: z.ZodString;
        reason: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        sessionId: string;
        reason?: string | undefined;
    }, {
        sessionId: string;
        reason?: string | undefined;
    }>;
    needsApproval: boolean;
    execute(input: z.infer<typeof InterruptAgentParameters>, context?: RunContext<Session>): Promise<ToolResult>;
    /** 当前会话所属树的主会话 id；解析失败回退自身 id（顶层会话本来就是自身）。 */
    private currentMainSessionId;
}
/**
 * `GoalService.set` 已是「设定/替换」语义（有目标时先注销再设，见 goal-protocol），
 * 所以 CreateGoal / UpdateGoal 共用同一个 schema 与同一条执行路径，只是名字不同 ——
 * 保留两个名字是为了让模型无论选哪个都能成功，而不是两套行为。
 */
declare const GoalConditionParameters: z.ZodObject<{
    condition: z.ZodString;
}, "strip", z.ZodTypeAny, {
    condition: string;
}, {
    condition: string;
}>;
export declare class CreateGoalTool extends BaseTool implements Tool {
    protected readonly goalService: GoalService;
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{
        condition: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        condition: string;
    }, {
        condition: string;
    }>;
    needsApproval: boolean;
    execute(input: z.infer<typeof GoalConditionParameters>, context?: RunContext<Session>): Promise<ToolResult>;
}
declare const GetGoalParameters: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
export declare class GetGoalTool extends BaseTool implements Tool {
    protected readonly goalService: GoalService;
    name: ToolNames;
    isConcurrencySafe(): boolean;
    description: string;
    parameters: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
    needsApproval: boolean;
    execute(_input: z.infer<typeof GetGoalParameters>, context?: RunContext<Session>): Promise<ToolResult>;
}
export declare class UpdateGoalTool extends BaseTool implements Tool {
    protected readonly goalService: GoalService;
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{
        condition: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        condition: string;
    }, {
        condition: string;
    }>;
    needsApproval: boolean;
    execute(input: z.infer<typeof GoalConditionParameters>, context?: RunContext<Session>): Promise<ToolResult>;
}
export {};
