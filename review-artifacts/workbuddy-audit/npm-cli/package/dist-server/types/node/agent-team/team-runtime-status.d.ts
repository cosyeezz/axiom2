import type { Session } from '../../vendor/cbc-core/node/index.js';
import { type TeamRuntimeLookupResult, type TeamRuntimeManifest, type TeamRuntimeMember, type TeamRuntimeMemberLifecycle, type TeamRuntimeMemberStatus, type TeamRuntimeStatus } from './team-runtime-manifest';
export interface TeamRuntimeMemberStatusView {
    name: string;
    agentId: string;
    taskId?: string;
    agentType: string;
    backendType: TeamRuntimeMember['backendType'];
    status: TeamRuntimeMemberStatus;
    lifecycle: TeamRuntimeMemberLifecycle;
    taskDescription?: string;
    updatedAt: number;
    canResume: boolean;
    pausedAfterCancel: boolean;
}
export interface TeamRuntimeStatusView {
    teamName: string;
    leadSessionId: string;
    leadAgentId: string;
    status: TeamRuntimeStatus;
    updatedAt: number;
    pausedAfterCancel: boolean;
    hasPausedMembers: boolean;
    hasResumablePausedMembers: boolean;
    members: TeamRuntimeMemberStatusView[];
}
export interface TeamRuntimeMemberLookupStatus extends TeamRuntimeLookupResult {
    runtime: TeamRuntimeStatusView;
    memberStatus: TeamRuntimeMemberStatusView;
}
export declare function toTeamRuntimeMemberStatus(member: TeamRuntimeMember, manifest: TeamRuntimeManifest): TeamRuntimeMemberStatusView;
export declare function toTeamRuntimeStatus(manifest: TeamRuntimeManifest): TeamRuntimeStatusView;
export declare function readTeamRuntimeStatus(teamName: string, session?: Session): Promise<TeamRuntimeStatusView | undefined>;
export declare function findTeamRuntimeMemberStatus(reference: string, leadSessionId?: string): Promise<TeamRuntimeMemberLookupStatus | undefined>;
