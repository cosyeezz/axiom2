import type { ToolResult } from '../tools/tool-protocol';
export declare const MULTITASK_MODE_NAME = "multitask";
/** 必须与 `MAIN_AGENT_META_KEY` 同字面量，本模块不反向 import main-agent-session。 */
export declare const MULTITASK_STANDING_META_KEY = "codebuddy.ai/mainAgent";
export declare const MULTITASK_MODE_META_KEY = "multitaskMode";
export declare const MULTITASK_ROLE_META_KEY = "multitaskRole";
/** 委托 overlay：与 multitaskMode 互斥、正交于权限模式。只认布尔 true。 */
export declare const DELEGATE_MODE_META_KEY = "delegateMode";
export declare const MULTITASK_ACTIVE_TASK_IDS_KEY = "multitaskActiveTaskIds";
/** 旧会话站立键曾写成 `multitask` 时，用来迁回进 overlay 前的 mode。新盖章不再写。 */
export declare const MULTITASK_PREVIOUS_AGENT_KEY = "multitaskPreviousAgent";
export declare const MULTITASK_SCOPE_BY_TASK_KEY = "multitaskWorkerScopeByTaskId";
export declare const MULTITASK_TASK_STORAGE_ID_KEY = "multitaskTaskStorageId";
export declare const MULTITASK_LAST_PLAN_KEY = "multitaskLastPlan";
export declare const MULTITASK_LAST_PLAN_TURN_KEY = "multitaskLastPlanTurn";
/** 每次真正打开/关掉 overlay 加一。关了之后每轮靠它决定要不要热注入站立工具面。 */
export declare const MULTITASK_SURFACE_EPOCH_KEY = "multitaskSurfaceEpoch";
export declare const MULTITASK_DELEGATED_FORBIDDEN = "delegated_work_forbidden";
/** 同批探测通过后才放行。不在 shipped 白名单里单独开；策略按 batch 判定。 */
export declare const MULTITASK_COORDINATOR_READONLY_TOOL_NAMES: readonly ["Grep", "Read"];
/** Overlay 打开时的热注入首句。拦截器 / notes / InspectSelf 共用，不作废历史。 */
export declare const OVERLAY_ON_SURFACE_LEAD: string;
/** 派工后：别空转等完成；用户问进度时必须读一次中途输出。 */
export declare const COORDINATOR_WAIT_FOR_NOTIFICATION: string;
/** 通知后：TaskOutput 就是用来读全文的。`<summary>` 只有 240 字标题。 */
export declare const COORDINATOR_READ_REPORT_THEN_SYNTHESIZE: string;
/** Code Mode overlay：对话层没有 TaskOutput，必须在 REPL 里 await 一次。 */
export declare const COORDINATOR_READ_REPORT_IN_REPL: string;
/** 每轮 reminder / InspectSelf / snapshot 共用，避免三处文案漂移。 */
export declare const COORDINATOR_BEHAVIOR_NOTES: string;
/** 协调器工具白名单。策略拦截与 shipped mode `tools` 共用这一份。 */
export declare const MULTITASK_COORDINATOR_TOOL_NAMES: readonly ["Agent", "TaskOutput", "TaskStop", "InterruptAgent", "ListAgents", "InspectSelf", "AskUserQuestion", "SendUserMessage", "Grep", "Read"];
export type MultitaskCoordinatorToolName = (typeof MULTITASK_COORDINATOR_TOOL_NAMES)[number];
export type MultitaskRole = 'coordinator' | 'worker';
/** 策略 / 盖章用的最小 session 面，避免单测拉齐完整 Session。 */
export interface MultitaskSessionRef {
    id?: string;
    /** 子代理落盘用 agent-*，反序列化后 role/parent 已丢，靠这个认 worker。 */
    storeId?: string;
    meta?: Record<string, unknown>;
    agentName?: string;
    options?: {
        permissionMode?: string;
    };
    permissionModeSubject?: {
        next(mode: string): void;
    };
}
export interface SpawnDetachedInput {
    prompt?: string;
    description?: string;
    model?: string;
    resume?: string;
    subagent_type?: string;
    name?: string;
    max_turns?: number;
    run_in_background?: boolean;
    scopeKey?: string;
}
export interface SpawnDetachedContext {
    session: MultitaskSessionRef & {
        id?: string;
    };
    input: SpawnDetachedInput;
    parentToolUseId?: string;
}
export interface PreparedCoordinatorSpawn {
    agentType: string;
    resume?: string;
    /** 目标 worker 仍 pending/running：禁止再 new 一条 execute。 */
    alreadyLive?: boolean;
    consumeBudget: boolean;
    description: string;
    prompt: string;
    /** Optional display label for this detached worker. It does not create a Team member. */
    displayName?: string;
    /** Original isolation mode of the worker being resumed. */
    historicalAgentIsolation?: 'worktree';
    scopeKey?: string;
}
export interface MultitaskProcessGuardOpts {
    /** 已归一化的进程 agent 名（`--multitask` 必须先收成 `multitask`）。 */
    agentName?: string;
    print?: boolean;
    streamJson?: boolean;
    stdoutIsTTY?: boolean;
    stdinIsTTY?: boolean;
    acp?: boolean;
    serve?: boolean;
    backgroundDisabled?: boolean;
}
export interface PlannerSpawnSibling {
    subagentType?: string;
    scopeKey: string;
    hint: string;
}
export type PlannerDecision = {
    action: 'answer_inline';
} | {
    action: 'spawn';
    subagentType: string;
    count: number;
    scopeKey?: string;
    siblings?: PlannerSpawnSibling[];
    followUp?: string;
} | {
    action: 'resume';
    taskId: string;
};
export interface CoordinatorLiveWorker {
    id: string;
    status: string;
    scopeKey?: string;
    description?: string;
}
export interface SelfSnapshot {
    role: 'coordinator';
    tools: readonly string[];
    liveWorkers: CoordinatorLiveWorker[];
    locks: string[];
    plan?: PlannerDecision;
    permissionMode?: string;
    notes: string;
}
export type CoordinatorToolDecision = ToolResult | null;
