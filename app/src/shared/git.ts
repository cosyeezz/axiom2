export interface GitBranchInfo {
  name: string;
  /** Detached HEAD is identified by a short commit hash, not a branch named HEAD. */
  detached: boolean;
}
