import type { AgentJobState } from './agent-view-protocol';
export type Workspace = Pick<AgentJobState, 'cwd' | 'worktreePath' | 'worktreeBranch' | 'originCwd'>;
export declare class LaunchWorkspaceError extends Error {
    readonly path: string;
    readonly code = "JOB_WORKSPACE_UNAVAILABLE";
    constructor(path: string, reason: string, options?: ErrorOptions);
}
export declare function ensureLaunchWorkspace(state: Workspace): Promise<string>;
export declare function launchWithWorkspaceRetry<T>(state: Workspace, launch: (cwd: string) => Promise<T>, prepare?: (state: Workspace) => Promise<string>): Promise<T>;
