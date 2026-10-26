import { Session } from '../../vendor/cbc-core/node/index.js';
export declare const TeamManager: unique symbol;
export declare const TeamMailbox: unique symbol;
export declare const TeamCleanupService: unique symbol;
export declare const TeamInboxDispatchService: unique symbol;
/**
 * Team member info stored in config.json
 * Based on ~/.codebuddy/teams/{name}/config.json format
 */
export interface TeamMemberInfo {
    /** Unique agent ID in format "{name}@{team-name}" */
    agentId: string;
    /** Human-friendly name (e.g. "ux-designer", "tech-architect") */
    name: string;
    /** 角色/职责名称（用于 UI 展示） */
    role?: string;
    /** Agent type (e.g. "team-lead", "general-purpose") */
    agentType: string;
    /** Model to use for this member */
    model?: string;
    /** Initial prompt for teammates (not set for team-lead) */
    prompt?: string;
    /** Display color for UI differentiation */
    color?: string;
    /** Whether plan mode is required for this member */
    planModeRequired?: boolean;
    /** Timestamp when the member joined */
    joinedAt: number;
    /** tmux pane ID - empty string for lead, "in-process" for in-process teammates */
    tmuxPaneId: string;
    /** Working directory */
    cwd: string;
    /** Message subscriptions */
    subscriptions: string[];
    /** Backend execution type */
    backendType?: 'in-process' | 'detached-process' | 'tmux';
    /** Worktree path if the member runs in worktree isolation */
    worktreePath?: string;
    /** Process PID (detached-process / tmux mode) */
    pid?: number;
    /** Log file path (detached-process / tmux mode) */
    logPath?: string;
}
/**
 * Team configuration stored at ~/.codebuddy/teams/{team-name}/config.json
 */
export interface TeamConfig {
    /** Canonical team name (also used as directory name) */
    name: string;
    /** Original name requested by TeamCreate when the canonical name was auto-renamed. */
    requestedName?: string;
    /** Team description/purpose */
    description?: string;
    /** Timestamp of team creation */
    createdAt: number;
    /** Agent ID of the team lead (format: "team-lead@{team-name}") */
    leadAgentId: string;
    /** Session ID of the team lead's session */
    leadSessionId: string;
    /** All team members including the lead */
    members: TeamMemberInfo[];
    /**
     * Whether this team was auto-created for background tasks.
     * Auto-teams are created transparently when run_in_background=true tasks
     * are spawned, and cleaned up automatically on session end.
     */
    isAutoTeam?: boolean;
}
/**
 * Message type for SendMessage tool
 */
export type TeamMessageType = 'message' | 'broadcast' | 'shutdown_request' | 'shutdown_response' | 'plan_approval_response';
/**
 * Single inbox message stored in ~/.codebuddy/teams/{team-name}/inboxes/{member}.json
 *
 * Each member's inbox is a JSON array of these messages.
 */
export interface InboxMessage {
    /**
     * Stable identity for exact acknowledgement. Legacy rows may omit this on
     * disk; TeamMailbox derives and persists a deterministic ID when loading
     * them.
     */
    id?: string;
    /** Sender name (e.g. "team-lead", "ux-designer") */
    from: string;
    /** Message content text */
    text: string;
    /** TUI Tab input: keep this user message for the next turn when the member is busy. */
    queueHold?: boolean;
    /** Short summary for UI preview (5-10 words) */
    summary?: string;
    /** ISO 8601 timestamp string */
    timestamp: string;
    /** Display color of the sender */
    color?: string;
    /** Whether the message has been read by the recipient */
    read: boolean;
}
export interface TeamManager {
    /**
     * Create a new team with config and directories
     * - Creates ~/.codebuddy/teams/{teamName}/config.json
     * - Creates ~/.codebuddy/teams/{teamName}/inboxes/
     * - Creates ~/.codebuddy/tasks/{teamName}/
     *
     * @param teamName Team name (used as directory name)
     * @param leadSession The lead agent's session
     * @param description Optional team description
     * @param agentType Optional lead agent type
     * @returns The created team config
     */
    createTeam(teamName: string, leadSession: Session, description?: string, agentType?: string, options?: {
        isAutoTeam?: boolean;
    }): Promise<TeamConfig>;
    /**
     * Delete team and task directories
     * Fails if active members still exist (non-lead members with active sessions)
     */
    deleteTeam(): Promise<void>;
    /**
     * Get current team config, or undefined if not in a team
     */
    getTeam(): TeamConfig | undefined;
    /**
     * Check if Agent Teams feature is enabled.
     * Controlled by env CODEBUDDY_CODE_EXPERIMENTAL_AGENT_TEAMS, or by the
     * session's `QueryOptions.agentTeams` inside a query that carries a Product.
     * When disabled, all team features (TeamCreate, TeamDelete, SendMessage,
     * background agent auto-team) are disabled.
     */
    isEnabled(): boolean;
    /**
     * Check if current session is in a team
     */
    isInTeam(): boolean;
    /**
     * Add a member to the team and persist config
     */
    addMember(member: TeamMemberInfo): Promise<void>;
    /**
     * Remove a member from the team by name and persist config
     */
    removeMember(memberName: string): Promise<void>;
    /**
     * Get all current team members
     */
    getMembers(): TeamMemberInfo[];
    /**
     * Find a member by name or agentId
     */
    getMember(nameOrId: string): TeamMemberInfo | undefined;
    /**
     * Update a member's info and persist config
     */
    updateMember(memberName: string, updates: Partial<TeamMemberInfo>): Promise<void>;
    /**
     * Load team config from disk for a given team name
     * Used to restore team state after restart
     */
    loadTeam(teamName: string): Promise<TeamConfig | undefined>;
    /**
     * Persist current team config to disk
     */
    saveConfig(): Promise<void>;
    /**
     * Re-read the current team's `members` list from disk and overlay it
     * onto the in-memory `teamConfig`. No-op when not currently in a team.
     *
     * Used to defeat snapshot/race conditions where one teammate's spawn has
     * not yet completed in-memory but `config.json` may already reflect a
     * later state (e.g. `SendMessage` resolves a recipient that was added
     * concurrently). Failures (file missing, parse error) are swallowed
     * silently — callers fall back to whatever the in-memory state was.
     */
    refreshFromDisk(): Promise<void>;
    /**
     * Get the team directory path: ~/.codebuddy/teams/{teamName}/
     */
    getTeamDir(): string | undefined;
    /**
     * Get the team's task directory path: ~/.codebuddy/tasks/{teamName}/
     */
    getTaskDir(): string | undefined;
    /**
     * Auto-create a lightweight team for background tasks.
     * Creates a team named `_auto_{sessionId}` with the main agent as team-lead.
     * Auto-teams bypass the agentTeam settings gate and are cleaned up on session end.
     *
     * @param sessionId The main session ID (used to generate team name)
     * @param leadSession The main agent's session
     * @returns The created team config
     */
    autoCreateTeam(sessionId: string, leadSession: Session): Promise<TeamConfig>;
    /**
     * Check if the current team is an auto-created team (for background tasks).
     * Returns false if not in a team.
     */
    isAutoTeam(): boolean;
    /**
     * Cleanup all teams created by the current process during this session
     * but never explicitly deleted via `deleteTeam()`.
     *
     * Mirrors Claude Code's `cleanupSessionTeams()` (gh-32730 fix): without
     * this safety net, every `TeamCreate` invocation leaves a permanent
     * `~/.codebuddy/teams/<name>/` directory on disk. With it, teams that
     * outlive their usefulness (lead exits without calling TeamDelete, agent
     * crashes mid-run, etc.) get wiped on graceful shutdown.
     *
     * Idempotent — safe to call multiple times. Implementations must:
     *   - Skip teams already removed by `deleteTeam()` (those self-unregister
     *     from the in-memory tracking set).
     *   - Best-effort: `Promise.allSettled` style; never throw.
     *   - Cleanup the same on-disk artifacts as `deleteTeam()` (config dir,
     *     inboxes, task dir, member worktrees if any).
     */
    cleanupSessionTeams(): Promise<void>;
}
export interface TeamMailbox {
    /**
     * Send a message to a specific member's inbox
     * Appends the message to ~/.codebuddy/teams/{teamName}/inboxes/{recipient}.json
     */
    send(teamName: string, recipient: string, message: Omit<InboxMessage, 'read'>): Promise<void>;
    /**
     * Broadcast a message to all members' inboxes (except the sender)
     */
    broadcast(teamName: string, sender: string, message: Omit<InboxMessage, 'read'>): Promise<string[]>;
    /**
     * Get all unread messages for a member
     */
    getUnread(teamName: string, memberName: string): Promise<InboxMessage[]>;
    /**
     * Get all messages for a member (read and unread)
     */
    getAll(teamName: string, memberName: string): Promise<InboxMessage[]>;
    /** Mark only the named message snapshots as read. */
    acknowledge(teamName: string, memberName: string, messageIds: readonly string[]): Promise<number>;
    /**
     * Serialize one exact unread delivery for this inbox. The callback must
     * succeed before those snapshot IDs are acknowledged. Rows appended while
     * the callback is running remain unread.
     */
    deliverUnreadOnce(teamName: string, memberName: string, callback: (messages: InboxMessage[]) => void | Promise<void>): Promise<boolean>;
    /**
     * Mark all messages as read for a member
     */
    markAllAsRead(teamName: string, memberName: string): Promise<void>;
    /**
     * Create an empty inbox file for a member
     */
    createInbox(teamName: string, memberName: string): Promise<void>;
    /**
     * Start polling for new messages for a member
     *
     * The callback may be sync (returns `void`) or async (returns
     * `Promise<void>`). The poller `await`s the callback before marking
     * exactly that unread snapshot as read, so a rejected promise (or a thrown
     * exception) keeps the messages unread for retry on the next poll.
     *
     * @returns Cleanup function to stop polling
     */
    startPolling(teamName: string, memberName: string, callback: (messages: InboxMessage[]) => void | Promise<void>, intervalMs?: number): () => void;
}
/**
 * Input for SendMessage tool - direct message
 */
export interface SendMessageInput {
    type: TeamMessageType;
    /** Recipient name (required for message, shutdown_request, plan_approval_response) */
    recipient?: string;
    /** Message text, reason, or feedback */
    content?: string;
    /** 5-10 word summary for UI preview (required for message, broadcast) */
    summary?: string;
    /** Request ID to respond to (required for shutdown_response, plan_approval_response) */
    request_id?: string;
    /** Whether to approve (required for shutdown_response, plan_approval_response) */
    approve?: boolean;
}
/**
 * Input for TeamCreate tool
 */
export interface TeamCreateInput {
    /** Name for the new team */
    team_name: string;
    /** Team description/purpose */
    description?: string;
    /** Type/role of the team lead */
    agent_type?: string;
}
/**
 * Format for injecting messages into teammate sessions.
 * Messages are wrapped in XML and injected as user-type messages:
 *
 * <teammate-message teammate_id="team-lead" summary="Brief summary">
 *   message content here
 * </teammate-message>
 */
export declare function formatTeammateMessage(from: string, summary: string, content: string): string;
/**
 * spawn 时初始任务分配的 summary 前缀。生产端（in-process-backend）与
 * 解析端（AcpTeamBridge 串线护栏、各端 sidebar/loader 提取器）共享此常量，
 * 避免消费侧硬编码字面量后随格式演进静默失配。
 */
export declare const INITIAL_ASSIGNMENT_SUMMARY_PREFIX = "Initial task assignment for ";
export declare function formatInitialAssignmentSummary(memberName: string): string;
/**
 * 从文本中解析初始任务分配的归属成员名；非初始任务文本返回 undefined。
 * 与 formatTeammateMessage + formatInitialAssignmentSummary 的输出同源，
 * 属性尾部用 [^>]* 容忍未来新增属性（与 repo 内其它 teammate-message 提取器一致）。
 */
export declare function parseInitialAssignmentOwner(text: string): string | undefined;
/**
 * Default color palette for teammates
 * Colors cycle for successive members
 */
export declare const TEAM_MEMBER_COLORS: readonly ["blue", "green", "yellow", "magenta", "cyan", "red"];
/**
 * Get a color for a team member based on their index (0-based, excluding lead)
 */
export declare function getTeamMemberColor(index: number): string;
/**
 * Service for cleaning up team resources, especially worktrees
 */
export interface TeamCleanupService {
    /**
     * Cleanup worktrees for all team members.
     * Called when the team is being dissolved.
     *
     * @param members Array of team members to cleanup
     * @returns Summary of cleanup results
     */
    cleanupTeamWorktrees(members: TeamMemberInfo[]): Promise<{
        cleaned: string[];
        preserved: string[];
        failed: string[];
    }>;
    /**
     * Cleanup worktree for a single team member.
     * Called when a member is removed from the team.
     *
     * @param member The team member to cleanup
     * @returns true if cleaned, false if preserved due to changes
     */
    cleanupMemberWorktree(member: TeamMemberInfo): Promise<boolean>;
}
/**
 * Auto-dispatch service for team inbox messages.
 *
 * Background: when the team-lead agent is busy (`stateMachine.isBusy(session)`),
 * teammate messages arriving via `TeamMailbox` are enqueued into the rich message queue
 * in Mode B. Without this service, no one would trigger `RichMessageQueueManager.activate()`,
 * so the queued messages would sit in the queue indefinitely until the user manually
 * intervenes. UI-sourced queue items rely on the renderer to activate; team-sourced items
 * have no UI hook, hence this CLI-internal auto-activator.
 *
 * Responsibility: subscribe to `SessionRunStateMachine.getChange$`, and on every transition
 * back to `idle` (the canonical equivalent of legacy `agent_end`) detect dispatchable items
 * in the rich queue. If any are present (and guards pass), call `activate()` and then
 * `AgentService.run()` to send the item as a fresh independent turn.
 *
 * Scope: one subscription per session, managed via `register` / `unregister`.
 */
export interface TeamInboxDispatchService {
    /**
     * Begin monitoring this session for auto-dispatch. Idempotent — calling twice on
     * the same session is a no-op.
     */
    register(session: Session): void;
    /**
     * Stop monitoring the session and release the underlying subscription.
     * Safe to call even if the session was never registered.
     */
    unregister(sessionId: string): void;
}
