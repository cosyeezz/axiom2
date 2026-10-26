export interface WorkspaceProjectIdentity {
    kind: 'directory' | 'git';
    path: string;
}
/**
 * Resolve Claude-compatible project identity for Plugin installation records.
 * Git worktrees use their canonical common/main repository root, while a
 * directory outside Git keeps its canonical requested path. Missing trailing
 * path components are preserved lexically after resolving the nearest existing
 * ancestor so historical registry records remain comparable.
 */
export declare function resolveWorkspaceProjectIdentity(workspacePath: string, options?: {
    preserveNonGitPath?: boolean;
}): Promise<WorkspaceProjectIdentity>;
export declare function resolveWorkspaceProjectRoot(workspacePath: string): Promise<string>;
//# sourceMappingURL=workspace-project-root.d.ts.map