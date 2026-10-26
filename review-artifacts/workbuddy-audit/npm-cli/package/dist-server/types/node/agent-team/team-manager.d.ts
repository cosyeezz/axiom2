import { Session } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { TeamCleanupService, TeamConfig, TeamManager, TeamMemberInfo } from './team-protocol';
/**
 * Implementation of TeamManager
 * Manages team lifecycle: creation, member management, persistence, deletion.
 *
 * Team data is stored at:
 *   ~/.codebuddy/teams/{teamName}/config.json
 *   ~/.codebuddy/teams/{teamName}/inboxes/
 *   ~/.codebuddy/tasks/{teamName}/
 *
 * Session isolation (pool / served): TeamManager is a process singleton shared
 * by every session in one SDK process. Both the in-memory active team and the
 * on-disk persistence are therefore partitioned by the query's root session —
 * the former via the `teamConfig` accessor below, the latter via the `dataFs`
 * seam (session-mounted fs in served, fs/promises passthrough in bin). Without
 * this a non-lead session would observe another session's team (roster leaks
 * into its prompt) and write teams onto the shared process disk.
 */
export declare class TeamManagerImpl implements TeamManager {
    protected readonly logger: Logger;
    protected readonly cleanupService: TeamCleanupService;
    /**
     * The active team, partitioned by the query's root session. `rootRunSession()`
     * resolves the query root (subagent / teammate runs nest inside the lead's
     * scope, so they resolve the lead's team — one team per query). Bin / unit
     * contexts enter no root scope and fall back to a single process-level slot,
     * preserving the original single-team-per-process behaviour. Exposed as a
     * private accessor named `teamConfig` so every `this.teamConfig` read/write
     * below is unchanged.
     */
    private readonly sessionTeamConfigs;
    private processTeamConfig;
    private get teamConfig();
    private set teamConfig(value);
    /**
     * Names of teams created by this process during the current session.
     *
     * Used by `cleanupSessionTeams()` (process-exit safety net, mirroring
     * Claude Code's `sessionCreatedTeams` / gh-32730 fix) to wipe teams that
     * the user/agent forgot to `deleteTeam()`. A team enters the set when
     * `createTeam()` (or `autoCreateTeam()`) succeeds, and leaves when
     * `deleteTeam()` removes it explicitly — the latter prevents
     * double-cleanup.
     *
     * Process-wide by name (auto-team names embed the sessionId, so entries
     * from different sessions never collide) — the set is only a shutdown
     * safety net that removes directories by name, not an active-team view.
     */
    private readonly sessionCreatedTeams;
    /**
     * A host's per-session setting (`QueryOptions.agentTeams`) applies inside its
     * query-owned run, subagent and teammate runs included. Process-wide builds
     * (no query Product) keep the process setting, so one session's value never
     * reaches the process-wide tool descriptions.
     */
    isEnabled(): boolean;
    isAutoTeam(): boolean;
    isInTeam(): boolean;
    createTeam(teamName: string, leadSession: Session, description?: string, agentType?: string, options?: {
        isAutoTeam?: boolean;
    }): Promise<TeamConfig>;
    autoCreateTeam(sessionId: string, leadSession: Session): Promise<TeamConfig>;
    deleteTeam(): Promise<void>;
    /**
     * Process-exit safety net: wipe every team this process created during
     * the current session that the user/agent forgot to delete explicitly.
     *
     * Mirrors Claude Code's `cleanupSessionTeams()` (gh-32730 fix). Without
     * it, every `TeamCreate` invocation leaves a permanent
     * `~/.codebuddy/teams/<name>/` directory; over time these accumulate and
     * pollute the user's `~/.codebuddy/teams/` listing (we observed ~20+
     * stale dirs in the wild during the 2026-05-21 dispatch-bug repro).
     *
     * Idempotent and best-effort:
     *   - Iterates the in-memory `sessionCreatedTeams` set (only this
     *     process's own teams — never touches teams from earlier sessions
     *     unless they were explicitly opened via `loadTeam`).
     *   - Each team is removed concurrently with `Promise.allSettled` so a
     *     single failure does not block the rest.
     *   - Always clears the set at the end, so a second invocation is a
     *     no-op even if some `rm` calls failed (we tried; nothing more we
     *     can do at process-exit time).
     *   - Does NOT call `deleteTeam()` because that requires `this.teamConfig`
     *     to be set; on shutdown we may not own the in-memory team anymore
     *     (e.g. lead session already torn down). Instead we directly remove
     *     the on-disk directories the same way `deleteTeam()` does.
     */
    cleanupSessionTeams(): Promise<void>;
    getTeam(): TeamConfig | undefined;
    getMembers(): TeamMemberInfo[];
    getMember(nameOrId: string): TeamMemberInfo | undefined;
    getTeamDir(): string | undefined;
    getTaskDir(): string | undefined;
    addMember(member: TeamMemberInfo): Promise<void>;
    removeMember(memberName: string): Promise<void>;
    updateMember(memberName: string, updates: Partial<TeamMemberInfo>): Promise<void>;
    loadTeam(teamName: string): Promise<TeamConfig | undefined>;
    /**
     * Re-read `members` from disk and overlay onto the in-memory teamConfig.
     *
     * Used by SendMessage and TeamContextInterceptor to defeat the spawn-race
     * window: when teammate B is `addMember`'d concurrently with teammate A
     * already running its first turn, A's in-memory snapshot may not yet
     * include B even though `config.json` does. A single cheap re-read closes
     * that gap without needing IPC or file watchers (matches Claude Code's
     * "writeToMailbox first, resolve later" philosophy).
     *
     * Only `members` is overlaid — runtime-only fields on `teamConfig` (e.g.
     * `leadSessionId` for the current process) are preserved. Failures are
     * silent so this is always safe to invoke.
     */
    refreshFromDisk(): Promise<void>;
    saveConfig(): Promise<void>;
    /**
     * Generate a unique team name when the desired name already exists on disk.
     * Appends a short random hex suffix, retrying up to 5 times. Falls back to
     * a timestamp-based suffix on persistent collision (extremely unlikely).
     */
    private resolveUniqueTeamName;
    private writeInbox;
    /**
     * Async existence probe replacing `existsSync` (lint rule `genie-n/no-sync`).
     * `dataFs.access` rejects when the path is missing or unreadable; we treat
     * both as "not present" since callers only need a boolean.
     */
    private pathExists;
}
