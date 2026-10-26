/**
 * Team Cleanup Service
 *
 * Responsible for cleaning up team resources, especially git worktrees
 * created for team members running in worktree isolation mode.
 */
import { type IWorktreeChangeDetector, type IWorktreeService } from '@genie/cbc-worktree';
import { Logger } from '@genie/telemetry';
import { TeamCleanupService, TeamMemberInfo } from './team-protocol';
export declare class TeamCleanupServiceImpl implements TeamCleanupService {
    protected readonly logger: Logger;
    protected readonly worktreeService: IWorktreeService;
    protected readonly changeDetector: IWorktreeChangeDetector;
    /**
     * Cleanup worktrees for all team members.
     * Called when the team is being dissolved.
     */
    cleanupTeamWorktrees(members: TeamMemberInfo[]): Promise<{
        cleaned: string[];
        preserved: string[];
        failed: string[];
    }>;
    /**
     * Cleanup worktree for a single team member.
     * Returns true if cleaned, false if preserved due to changes.
     */
    cleanupMemberWorktree(member: TeamMemberInfo): Promise<boolean>;
}
