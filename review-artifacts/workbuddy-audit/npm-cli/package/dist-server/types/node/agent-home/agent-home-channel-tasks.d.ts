/**
 * 频道任务板（黑板）：类型 + 落盘 IO + 纯函数 mutateBoard（领域层，无文案/HTTP/唤醒）。
 * 单写者纪律是产品语义：claim 走 CAS、只有 owner 能 complete/release、done 不可变、
 * 唤醒预算按「任务 × 人」计（超限标 stalled 停叫）。
 */
import type { AgentHomeChannelTaskEventPayload } from './agent-home-channel-task-event';
import type { ChannelTaskErrorCode } from './agent-home-errors';
export { channelTaskTone, compareChannelTasks } from './agent-home-channel-task-order';
export type AgentHomeChannelTaskStatus = 'open' | 'claimed' | 'done';
export interface AgentHomeChannelTaskRef {
    kind: 'issue' | 'file' | 'pr' | 'commit' | 'url';
    value: string;
}
/** kind 的运行时白名单（类型只管编译期；盘上手改/旧数据可能是任意串）。HTTP 与 domain 共用这一份。 */
export declare const TASK_REF_KINDS: ReadonlySet<string>;
export interface AgentHomeChannelTask {
    id: string;
    subject: string;
    detail?: string;
    status: AgentHomeChannelTaskStatus;
    ownerId?: string;
    /** dispatch 指定的接收人：只有本人能 claim。 */
    assigneeId?: string;
    refs?: AgentHomeChannelTaskRef[];
    /**
     * 手工顺序（拖拽排序）。只在**同一个色调分组内**比较：小的在前；
     * 没设过的手工顺序（老数据 / 新任务的旧写法）排在最后，按 updatedAt 倒序。
     */
    sortIndex?: number;
    /** create / dispatch 的幂等键。 */
    requestId?: string;
    createdBy: 'user' | 'agent';
    creatorAgentId?: string;
    /** 派活时所在的主会话：完成回执投回这个会话，而不是谁先空闲谁拿。 */
    originSessionId?: string;
    /** 每人对本任务的自动唤醒次数（只增不减）。 */
    wakeCounts?: Record<string, number>;
    stalled?: boolean;
    stalledReason?: 'wake_budget';
    createdAt: number;
    updatedAt: number;
    doneAt?: number;
}
export interface AgentHomeChannelTaskBoard {
    version: 1;
    tasks: AgentHomeChannelTask[];
    /**
     * 下一个要发的任务号。删了任务也要往上走——id 复用会让时间线里的 t3
     * 前后指的不是同一条活（历史是 append-only 的，不能重编号）。
     */
    nextTaskId?: number;
}
/** 任务板文件：channels/<id>.tasks.json。文件名 = channel.id，不是显示名。 */
export declare function agentHomeChannelTasksPath(homeDir: string, channelId: string): string;
export declare const EMPTY_CHANNEL_TASK_BOARD: AgentHomeChannelTaskBoard;
export declare function parseAgentHomeChannelTaskBoard(raw: string): AgentHomeChannelTaskBoard;
/** 免锁读（GET / 看板快照语义）。缺文件 / 坏文件都当空板。 */
export declare function readAgentHomeChannelTasksSync(homeDir: string, channelId: string): AgentHomeChannelTaskBoard;
/** 锁内写：tmp + rename，避免半截 JSON。 */
export declare function writeAgentHomeChannelTasks(homeDir: string, channelId: string, board: AgentHomeChannelTaskBoard): Promise<void>;
export type AgentHomeChannelTaskActor = {
    kind: 'agent';
    agentId: string;
    isLead: boolean;
} | {
    kind: 'user';
};
export type ChannelTaskEventType = 'created' | 'claimed' | 'completed' | 'released' | 'dispatched' | 'nudged' | 'escalated' | 'stalled'
/** 板上最后一项也完成了：这一批结束了，该有人回报委托人（lead 的活）。 */
 | 'batch_done'
/** 改了任务本身（标题 / 细节 / 指派 / 引用）：编排与用户都能纠错。 */
 | 'updated'
/** 从板上撤掉一条（历史行留在时间线里，这一行记谁撤的）。 */
 | 'deleted';
/**
 * 结构化事件：文案由 copy 层生成，这里只给数据。
 * 形状与落盘记录 / web-ui 共用 `agent-home-channel-task-event`（那份是 SSOT）。
 */
export type ChannelTaskEvent = AgentHomeChannelTaskEventPayload & {
    type: ChannelTaskEventType;
};
export type ChannelTaskAction = {
    type: 'create';
    subject: string;
    detail?: string;
    assignAgentId?: string;
    refs?: AgentHomeChannelTaskRef[];
    requestId?: string;
    /** 发起这条活的主会话：完成回执按地址投回。 */
    originSessionId?: string;
} | {
    type: 'claim';
    taskId: string;
} | {
    type: 'update';
    taskId: string;
    /** 只传要改的字段；`null` 表示清空（细节 / 取消指派 / 清空引用），不传表示不动。 */
    subject?: string;
    detail?: string | null;
    assignAgentId?: string | null;
    /** 整表替换（UI 的加/删引用都在客户端算好整份传上来）。 */
    refs?: AgentHomeChannelTaskRef[] | null;
} | {
    type: 'delete';
    taskId: string;
}
/** 同组内重排：`toIndex` 是这一组（停滞 / 进行中 / 待认领 / 已完成）里的目标位次。 */
 | {
    type: 'move';
    taskId: string;
    toIndex: number;
} | {
    type: 'complete';
    taskId: string;
    refs?: AgentHomeChannelTaskRef[];
} | {
    type: 'release';
    taskId: string;
} | {
    type: 'dispatch';
    items: {
        subject: string;
        detail?: string;
        assignAgentId: string;
        refs?: AgentHomeChannelTaskRef[];
        originSessionId?: string;
    }[];
    requestId?: string;
} | {
    type: 'escalate';
    mode: 'nudge' | 'release';
    taskIds?: string[];
    maxStaleMs?: number;
};
export interface ChannelTaskMutationInput {
    board: AgentHomeChannelTaskBoard;
    actor: AgentHomeChannelTaskActor;
    action: ChannelTaskAction;
    now: number;
    /** 频道 lead（agentId）；缺省 = user-as-lead。竞态外的唤醒目标用。 */
    leadAgentId?: string;
    /** 单板任务上限，默认 MAX_TASKS_PER_CHANNEL（测试可覆盖）。 */
    maxTasks?: number;
    /** 唤醒预算，默认 MAX_WAKE_PER_TASK_PER_AGENT（测试可覆盖）。 */
    wakeBudget?: number;
}
export interface ChannelTaskMutationSuccess {
    ok: true;
    board: AgentHomeChannelTaskBoard;
    events: ChannelTaskEvent[];
    /** 需要叫醒的人（已扣预算；预算耗尽的人不在内，任务已标 stalled）。 */
    wakeAgentIds: string[];
    /** 本次操作直接涉及的任务（工具返回值用）。 */
    tasks: AgentHomeChannelTask[];
}
export type ChannelTaskMutationResult = ChannelTaskMutationSuccess | {
    ok: false;
    error: ChannelTaskErrorCode;
};
export declare function normalizeTaskSubject(subject: string): string;
export declare function mutateChannelTaskBoard(input: ChannelTaskMutationInput): ChannelTaskMutationResult;
