import type { Session } from '../../vendor/cbc-core/node/index.js';
/**
 * Subagent spawn limits — 对齐 Claude Code 的 subagent 约束（机制差异见下文）。
 *
 * 与 Claude Code 的关系（已对 CC 源码核对）：CC 的基线做法是「子代理拿不到 Agent
 * 工具」——非 ant 用户的子代理工具集里直接移除 Agent，因此根本无法再 spawn（等效 0
 * 层嵌套），并没有一个可配置的 depth 计数器。genie 在此之上保留三道闸（防御纵深）：
 * - **Nesting depth**: 子代理到第 5 层不能再 spawn（固定，不可配置）。
 * - **Concurrent executions**: 参考 Codex 的共享 execution limiter， 同一根会话树最多同时运行 N 个子代理，默认 20，可用
 *   CODEBUDDY_CODE_MAX_CONCURRENT_SUBAGENTS 调整（正整数，不能关）。采用 reservation +
 *   幂等 release，避免并发 check-then-increment 穿透上限；终态或移除时归还槽位。
 * - **Per-session budget**: 每次 CLI 进程运行内最多 N 次 spawn，默认 200，可用
 *   CODEBUDDY_CODE_MAX_SUBAGENTS_PER_SESSION 上调（正整数，不能关）。计数存活于内存
 *   （`session.meta.subagentSpawnBudget`）。注意：该计数**不跨进程持久化**——meta.json
 *   仅在会话创建时落盘（彼时 count=0），consumeSpawn 的增量不回写，故跨进程
 *   resume 会从 0 重新计数，`/clear` 新建 session 也重置。因此这道闸拦的是
 *   「单次运行内失控刷 subagent」，而非会话整个生命周期的累计上限。
 *
 * 整棵会话树的计数以共享 spawn budget 对象为锚点：
 * - 并发执行状态仅存于运行时，并以该共享对象为键；
 * - `subagentDepth`: number of subagent levels below the main conversation
 *   (main session = 0). Stamped onto each sub-session at spawn.
 * - `subagentSpawnBudget`: a `{ count }` object owned by the root session and
 *   SHARED by reference with every descendant sub-session, so nested spawns
 *   consume the same budget no matter which level initiates them.
 *
 * Scope note: propagation covers in-process subagents (AgentTask sync +
 * in-process background/team members). Subprocess teammates (tmux/detached
 * backends) run in their own OS process with a fresh session and are not
 * chained into the parent budget.
 */
/** Fixed maximum nesting depth (levels below the main conversation). */
export declare const MAX_SUBAGENT_DEPTH = 5;
/** 单个根会话树中默认允许同时执行的子代理数量。 */
export declare const DEFAULT_MAX_CONCURRENT_SUBAGENTS = 20;
/** 子代理并发执行上限的环境变量覆盖值（正整数，无固定最大值）。 */
export declare const ENV_MAX_CONCURRENT_SUBAGENTS = "CODEBUDDY_CODE_MAX_CONCURRENT_SUBAGENTS";
/** Default per-session subagent spawn budget. */
export declare const DEFAULT_MAX_SUBAGENTS_PER_SESSION = 200;
/** Env override for the per-session budget (positive integer, no upper bound). */
export declare const ENV_MAX_SUBAGENTS_PER_SESSION = "CODEBUDDY_CODE_MAX_SUBAGENTS_PER_SESSION";
export interface SubagentSpawnBudget {
    count: number;
}
export interface SubagentExecutionSlot {
    release(): void;
}
/** Depth of the given session below the main conversation (main = 0). */
export declare function getSubagentDepth(session: Pick<Session, 'meta'>): number;
/** Depth to stamp on a sub-session spawned FROM the given session. */
export declare function nextSubagentDepth(spawningSession: Pick<Session, 'meta'>): number;
/** 生效的并发执行上限：有效的正整数环境变量值，否则使用默认值。 */
export declare function getMaxConcurrentSubagents(): number;
/** Effective per-session budget: env override (positive int) or the default. */
export declare function getMaxSubagentsPerSession(): number;
/**
 * The session's spawn budget object. Created lazily on the root session;
 * sub-sessions receive the same object by reference at spawn time, so this
 * returns the shared root budget for any session in the tree.
 */
export declare function getOrCreateSpawnBudget(session: Pick<Session, 'meta'>): SubagentSpawnBudget;
export type SpawnCheckResult = {
    ok: true;
} | {
    ok: false;
    kind: 'depth' | 'concurrency' | 'budget';
    reason: string;
};
export declare function getActiveSubagentExecutions(session: Pick<Session, 'meta'>): number;
/** 原子预留一个执行槽；返回的释放操作具备幂等性。 */
export declare function acquireSubagentExecutionSlot(session: Pick<Session, 'meta'>): SubagentExecutionSlot;
/**
 * Gate a spawn attempt from `spawningSession`: enforce the depth cap, current
 * execution capacity, and shared per-session budget WITHOUT consuming either counter. Call once per Agent-tool
 * dispatch, before any spawn path runs, so over-limit spawns are rejected
 * early; pair with `consumeSpawn` after a spawn has actually succeeded, so
 * failed attempts (invalid type, no active team, internal spawn failure) and
 * resume calls never burn budget.
 */
export declare function checkSpawnAllowed(spawningSession: Pick<Session, 'meta'>): SpawnCheckResult;
/**
 * Consume one unit of the shared session budget. Call only after a spawn has
 * actually been created — never on resume calls or on failed spawn attempts.
 */
export declare function consumeSpawn(spawningSession: Pick<Session, 'meta'>): void;
/**
 * Refund one unit after a spawn that never produced a result (sync / quick fail).
 * Never decrements below 0.
 */
export declare function refundSpawn(spawningSession: Pick<Session, 'meta'>): void;
