import type { TeammateBackendType } from './backends/teammate-backend-protocol';
import type { TeamConfig, TeamMemberInfo } from './team-protocol';
export declare const TEAM_RUNTIME_MANIFEST_VERSION = 1;
export declare const TEAM_RUNTIME_MANIFEST_FILE = "runtime.json";
export type TeamRuntimeStatus = 'active' | 'paused_after_cancel' | 'completed' | 'cancelled';
export type TeamRuntimeMemberStatus = 'running' | 'idle' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'killed' | 'unresumable';
export type TeamRuntimeMemberLifecycle = 'alive' | 'terminated';
export interface TeamRuntimeMember {
    name: string;
    agentId: string;
    taskId?: string;
    agentType: string;
    backendType: TeammateBackendType;
    model?: string;
    prompt?: string;
    cwd?: string;
    color?: string;
    permissionMode?: string;
    planApproved?: boolean;
    maxTurns?: number;
    taskDescription?: string;
    resumeSessionId?: string;
    transcriptPath?: string;
    status: TeamRuntimeMemberStatus;
    /** Logical actor lifecycle. Missing in legacy v1 manifests means alive. */
    lifecycle?: TeamRuntimeMemberLifecycle;
    updatedAt: number;
}
export interface TeamRuntimeManifest {
    version: typeof TEAM_RUNTIME_MANIFEST_VERSION;
    teamName: string;
    leadSessionId: string;
    leadAgentId: string;
    createdAt: number;
    updatedAt: number;
    status: TeamRuntimeStatus;
    members: TeamRuntimeMember[];
}
export interface TeamRuntimeMemberRecordOptions {
    taskId?: string;
    status?: TeamRuntimeMemberStatus;
    /** Permanent logical shutdown is monotonic for one durable member identity. */
    lifecycle?: 'terminated';
    permissionMode?: string;
    planApproved?: boolean;
    maxTurns?: number;
    taskDescription?: string;
}
export interface TeamRuntimeLookupResult {
    manifest: TeamRuntimeManifest;
    member: TeamRuntimeMember;
}
export declare function getTeamRuntimeManifestPath(teamName: string): string;
export declare function getTeamMemberTranscriptPath(leadSessionId: string, taskId: string): string;
export declare function readTeamConfig(teamName: string): Promise<TeamConfig | undefined>;
export declare function findTeamConfigByLeadSessionId(leadSessionId: string): Promise<TeamConfig | undefined>;
export declare function readTeamRuntimeManifest(teamName: string): Promise<TeamRuntimeManifest | undefined>;
export declare function writeTeamRuntimeManifest(manifest: TeamRuntimeManifest): Promise<void>;
export declare function createTeamRuntimeManifest(config: TeamConfig, status?: TeamRuntimeStatus): TeamRuntimeManifest;
export declare function ensureTeamRuntimeManifest(config: TeamConfig, status?: TeamRuntimeStatus): Promise<TeamRuntimeManifest>;
export declare function recordTeamRuntimeMember(teamName: string, leadSessionId: string, leadAgentId: string, member: TeamMemberInfo, options?: TeamRuntimeMemberRecordOptions): Promise<TeamRuntimeManifest>;
export declare function updateTeamRuntimeMemberStatus(teamName: string, memberName: string, status: TeamRuntimeMemberStatus): Promise<void>;
export declare function markTeamRuntimePausedAfterCancel(teamName: string, leadSessionId?: string): Promise<void>;
export declare function markTeamRuntimeActiveAfterHumanResume(teamName: string, leadSessionId?: string): Promise<void>;
export declare function findTeamRuntimeManifestByLeadSessionId(leadSessionId: string): Promise<TeamRuntimeManifest | undefined>;
export declare function findTeamRuntimeMemberByReference(reference: string, leadSessionId?: string): Promise<TeamRuntimeLookupResult | undefined>;
