import type { AgentInputItem } from '../../../cbc-shared/node/index.js';
import type { Session } from '../session/session-protocol';
export { ENV_KEY_CODEBUDDY_TASK_LIST_ID } from '../session/session-constants';
/**
 * Runtime meta on a session that runs on behalf of another one (one-off helper runs, `/btw`,
 * subagents): the owner's {@link SessionUtils.resolveRootSessionId}.
 */
export declare const ROOT_SESSION_META_KEY = "codebuddy.ai/rootSessionId";
export declare abstract class SessionUtils {
    static is(session?: any): session is Session;
    /**
     * 生成自定义 sessionId,
     * 格式: agent-{UUID}
     *
     * 保留完整 UUID，避免截断到 32-bit 后在长期持久化的子 Agent
     * session 中发生实际可见的 ID 冲突。
     */
    static subAgentId(): string;
    static isSubAgent(session: {
        id?: string;
        storeId?: string;
    }): boolean;
    /**
     * Clone one history item for a fork without duplicating large string payloads.
     *
     * 隔离范围**刻意只覆盖 fork 会就地改写的字段**：顶层 id 链（id/parentId/logicalParentId
     * 由 fork-command-executor 重写）以及 message.content[] / providerData.toolResult.content[] /
     * output[] / 顶层 content[] 这些存在元素级就地写路径（如 replaceGifUserInputsWithPlaceholder）
     * 的容器。`message.tool_calls`、`providerData.usage` 等嵌套可变对象**故意保持与源 session
     * 共享引用**——当前 fork 流程无 mutate 它们的路径，共享可省内存。
     *
     * ⚠️ 未来若新增「fork 后原地改 tool_calls / usage / 其它更深字段」的路径，必须在此
     * 为对应字段补一层浅拷，否则会污染源 session。
     */
    static cloneHistoryItemForFork(item: AgentInputItem): AgentInputItem;
    /**
     * 判断 session 是否处于「专家团 / agent-team 场景」。
     *
     * 覆盖两类角色：
     * - 团队主持（lead）：创建 / 加入 team 后写入 meta.isTeamLead = true
     *   （团队删除或 /clear 时清除）。
     * - 团队成员（teammate）：teammate-runner 启动会话时写入 meta.isTeamMember = true。
     *
     * 用于在专家团场景下关闭 request 级别（PreMessage）的上下文压缩等行为。
     */
    static isTeamSession(session?: Session): boolean;
    static resolveTeamLeadTeamName(session?: Session): string | undefined;
    /** Arm the lead-cancel barrier and advance its epoch (see `Session.teamCancelEpoch`). */
    static markTeamCancelled(session: Session): void;
    /**
     * Resolve the task list session ID.
     * Priority: isolated multitask worker storage > CODEBUDDY_TASK_LIST_ID env var > parentSessionId > session.id
     *
     * When CODEBUDDY_TASK_LIST_ID is set, tasks are stored under
     * ~/.codebuddy/tasks/{CODEBUDDY_TASK_LIST_ID}/ allowing task lists
     * to be shared across sessions.
     */
    static resolveIsolatedTaskSessionId(session?: {
        meta?: {
            multitaskTaskStorageId?: string;
        };
    }): string | undefined;
    static resolveTaskStorageId(session: {
        meta?: {
            parentSessionId?: string;
            multitaskTaskStorageId?: string;
        };
        id?: string;
    } | undefined, teamName?: string): string | undefined;
    /**
     * Root of a session's lineage: the id behind `${CODEBUDDY_SESSION_ID}` in model credentials,
     * which aihub uses as `cache_task_id` to pin every call of a task to one upstream account.
     * A history replaying Responses items keeps the root they were produced under
     * (`providerData.upstream.rootSessionId`), so forks stay on the account that can decrypt
     * the replayed reasoning. Unlike {@link resolveTaskSessionId}, which picks task-list storage.
     */
    static resolveRootSessionId(session: {
        id: string;
        history?: readonly unknown[];
        meta?: Record<string, unknown>;
    }): string;
    /** Marks `session` as running on behalf of `owner`, sharing its lineage root. */
    static adoptRootSession(session: Session, owner: Session | undefined): void;
    private static replayedRootSessionId;
    static resolveTaskSessionId(session?: {
        meta?: {
            parentSessionId?: string;
            multitaskTaskStorageId?: string;
        };
        id?: string;
    }): string | undefined;
}
//# sourceMappingURL=session-utils.d.ts.map