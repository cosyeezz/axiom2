import { type AgentTaskManager } from '../agent-task/agent-task-protocol';
import { type CoordinatorLiveWorker, type MultitaskSessionRef } from './types';
/** starting 短路有 TTL：二次 init 泄漏时 sweep 仍能拆掉僵尸。 */
export declare const STARTING_DELEGATION_TTL_MS = 30000;
/**
 * worker session 打标（markWorkerSession）完成时刻的监听者。
 * 唯一的生产消费者是 coordinator-acp-bridge：worker session 在 AgentTask.execute()
 * 的 setupPhase 里才创建，spawn 路径拿不到，靠这个钩子在创建的同一调用栈里挂桥。
 */
export type MultitaskWorkerSessionListener = (worker: MultitaskSessionRef, parent?: MultitaskSessionRef) => void;
/** 返回退订函数。监听者抛错只 warn，不影响打标主流程。 */
export declare function onMultitaskWorkerSession(listener: MultitaskWorkerSessionListener): () => void;
/** 极简站立不能开 overlay（无子代理面）。站立键优先，否则看 leftover agentName。 */
export declare function isMinimalStandingForMultitask(session?: MultitaskSessionRef | null): boolean;
/** 只认布尔 `true`。字符串 `"true"` / 1 都算关，避免脏 meta 误开。 */
export declare function isMultitaskMode(session?: MultitaskSessionRef | null): boolean;
/** 协调器：mode 开且非 worker/子会话。 */
export declare function isMultitaskCoordinator(session?: MultitaskSessionRef | null): boolean;
/** 委托 overlay 旗标。只认布尔 `true`。 */
export declare function isDelegateMode(session?: MultitaskSessionRef | null): boolean;
export type CoordinatorMode = 'off' | 'multitask' | 'delegate';
/**
 * 协调工作模式 overlay（与权限模式正交）。multitask / delegate 由 stamp 保证互斥；
 * 脏 meta 两者同开时按更严格的 delegate 判定（fail-closed）。worker / 子会话恒 off。
 */
export declare function isCoordinatorMode(session?: MultitaskSessionRef | null): CoordinatorMode;
export declare function shouldDetachCoordinatorSpawn(session?: MultitaskSessionRef | null): boolean;
/** overlay 已开，或旧会话站立键 / agentName 仍是 multitask（挡住同步 Agent 堵主会话）。 */
export declare function isCoordinatorStanding(session?: MultitaskSessionRef | null): boolean;
/** worker / 子会话 / 落盘 agent-* 转录。续聊、斜杠、选名共用，避免只认内存 role。 */
export declare function isMultitaskWorkerOrSubagent(session?: MultitaskSessionRef | null): boolean;
/** overlay 会落盘；旧站立键 `multitask` 时补盖并迁回。DISABLE_BACKGROUND 下不盖。 */
export declare function restoreCoordinatorFromStanding(session?: MultitaskSessionRef | null): void;
/** overlay 真正打开/关掉过几次。关了之后靠它决定要不要热注入站立工具面。 */
export declare function readSurfaceEpoch(session?: MultitaskSessionRef | null): number;
/** REPL 常驻 kernel 目录新鲜度：indexEpoch + overlay 开关。两者都只增，和单调。 */
export declare function overlayCatalogEpoch(indexEpoch: number, session?: MultitaskSessionRef | null): number;
/** 只开 overlay（mode + coordinator role）。不改站立 mode / agentName / permissionMode。先清委托（互斥）。 */
export declare function stampMultitaskSession(session: MultitaskSessionRef): void;
/** 关掉 overlay。站立 mode 不动；旧会话若站立键仍是 multitask 则迁回。锁不清。 */
export declare function clearMultitaskSession(session: MultitaskSessionRef): void;
/**
 * 开委托 overlay：delegateMode + coordinator role。先清 multitask（互斥），不改站立 mode /
 * agentName / permissionMode。极简也可开（委托不依赖站立子代理面，沙箱换成委托白名单）。
 */
export declare function stampDelegateSession(session: MultitaskSessionRef): void;
/** 关委托 overlay。站立 mode / 权限模式不动；锁不清（与 multitask 同口径）。 */
export declare function clearDelegateSession(session: MultitaskSessionRef): void;
export declare function markDelegationStarting(taskId: string): void;
export declare function clearDelegationStarting(taskId: string): void;
export declare function resetDelegationStartingForTests(): void;
/** 测试用：清掉未正常 detach 的桥监听，避免跨用例泄漏。生产靠 worker 终态拆订阅。 */
export declare function resetWorkerSessionListenersForTests(): void;
export declare function addDelegationLock(session: MultitaskSessionRef, taskId: string): void;
export declare function clearDelegationLock(session: MultitaskSessionRef, taskId: string): void;
export declare function hasLiveDelegation(session?: MultitaskSessionRef | null): boolean;
export declare function listDelegationLockIds(session?: MultitaskSessionRef | null): string[];
export declare function normalizeWorkerScopeKey(scopeKey?: string): string | undefined;
export declare function setWorkerScopeKey(session: MultitaskSessionRef, taskId: string, scopeKey?: string): void;
export declare function getWorkerScopeKey(session: MultitaskSessionRef | null | undefined, taskId: string): string | undefined;
export declare function clearWorkerScopeKey(session: MultitaskSessionRef, taskId: string): void;
/**
 * Coordinator UI surface: expose every delegation lock without sweeping it through
 * this process's TaskManager. Detached workers may execute in another runtime,
 * while the coordinator session meta is the shared cross-runtime source of truth.
 *
 * Keep this separate from listCoordinatorLiveWorkers(), whose lock ∩ local
 * TaskManager semantics are intentionally used by lifecycle/cleanup logic.
 */
export declare function listCoordinatorSurfaceWorkers(session?: MultitaskSessionRef | null): CoordinatorLiveWorker[] | null;
/** 协调器 ListAgents：活锁 ∩ TaskManager live。非协调器返回 null（走原目录）。 */
export declare function listCoordinatorLiveWorkers(session?: MultitaskSessionRef | null): CoordinatorLiveWorker[] | null;
/** Ask / ExitPlanMode only. Write/Bash and other permissions still follow parent teardown. */
export declare function isLiveDetachedWorkerHitlTool(effectiveToolName: unknown): boolean;
/**
 * Live coordinator worker: `multitaskRole=worker` and a pending/running AgentTask
 * whose sub-session matches `source`. Fail-closed if TaskManager is unavailable.
 *
 * Do not use `parentSessionId` alone — ordinary (non-multitask) subagents must
 * still lose HITL when the parent turn is cancelled.
 */
export declare function isLiveDetachedWorkerSession(source?: MultitaskSessionRef | null, parentSessionId?: string): boolean;
/**
 * Parent-turn sweep (`prompt_timeout` / user Stop / sandbox timeout) must not
 * settle a live detached worker's Ask/plan. Closing the parent session still does.
 */
export declare function shouldKeepLiveDetachedWorkerHitl(args: {
    effectiveToolName: unknown;
    source?: MultitaskSessionRef | null;
    sweepSessionId: string;
    reason: string;
}): boolean;
/** 只读协议上的 `resume`，不穿透实现类 private `config`。 */
export declare function readTaskResumeId(task: {
    resume?: unknown;
}): string | undefined;
/** 按 task.id / sessionId / resume 找任意状态的任务（含已终态，供 resume 验 id）。 */
export declare function findMatchingTask(taskManager: AgentTaskManager, taskId: string): ReturnType<AgentTaskManager['getTask']>;
/** 按 task.id / sessionId / resume 找仍 pending/running 的 worker。 */
export declare function findLiveMatchingTask(taskManager: AgentTaskManager, taskId: string): ReturnType<AgentTaskManager['getTask']>;
/** live = pending/running（含别名）。死任务清锁；TaskManager 不可用则认锁数组。 */
export declare function isLiveDelegationId(session?: MultitaskSessionRef | null, taskId?: string): boolean;
/** 先回灌再扫僵尸。新开 worker 和终态通知都要走。 */
export declare function sweepStaleDelegationLocks(session?: MultitaskSessionRef | null): void;
/** 第一条活锁（顺手清僵尸）。不参与默认派工。 */
export declare function resolveLiveResume(session?: MultitaskSessionRef | null): string | undefined;
/** worker：标 role、剥 multitaskMode / delegateMode，从父会话抄 acpConnectionId。 */
export declare function markWorkerSession(session: MultitaskSessionRef, parent?: MultitaskSessionRef): void;
export declare function markModuleSpawn(taskId: string): void;
export declare function clearModuleSpawn(taskId: string): void;
export declare function isModuleSpawned(taskId?: string): boolean;
export declare function resetModuleSpawnMarksForTests(): void;
export declare function shouldSkipTeamNotification(task: {
    id?: string;
    teamContext?: unknown;
    getMainSession?: () => MultitaskSessionRef | undefined;
} | null | undefined): boolean;
export declare function applyCoordinatorTaskOutput<T extends {
    block?: unknown;
}>(session: MultitaskSessionRef | null | undefined, input: T): T;
export declare const COORDINATOR_TASKOUTPUT_RUNNING_HINT: string;
/** 协调器上把「稍后再查」改成禁止空转，避免 block=false 后模型仍 tight-loop。 */
export declare function annotateCoordinatorTaskOutput<T extends {
    content?: unknown;
}>(session: MultitaskSessionRef | null | undefined, result: T): T;
