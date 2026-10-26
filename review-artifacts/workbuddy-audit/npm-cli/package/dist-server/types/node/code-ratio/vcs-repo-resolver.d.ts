import { CodeRatioRepoContext, CodeRatioRepoResolver } from '@genie/code-ratio';
export { CodeRatioRepoContext, CodeRatioRepoResolver, toPosixRelative } from '@genie/code-ratio';
export interface VcsRoot {
    repoRoot: string;
    vcsType: NonNullable<CodeRatioRepoContext['vcsType']>;
}
/**
 * CLI-native implementation of CodeRatioRepoResolver.
 *
 * Unlike agent-craft which can lean on the vscode git extension via
 * VCSManager, the CLI only has filesystem access. We walk up from the
 * given absolute file path to locate the nearest `.git` directory and
 * read remote/branch info through GitInfoExtractor (already used by the
 * existing VCSEventProcessor, so behavior stays consistent).
 *
 * Results are cached per repo root with a 5-minute TTL, matching the
 * cache strategy of VCSEventProcessor.
 */
export declare class CwdRepoResolver implements CodeRatioRepoResolver {
    private readonly cache;
    private logger?;
    constructor();
    resolve(absoluteFilePath: string): CodeRatioRepoContext | undefined;
    getCurrentRepoRoot(): string | undefined;
    private getRepoEntry;
    private readGitRepoEntry;
    private readSvnRepoEntry;
}
/**
 * Walk upwards from `startPath` looking for the nearest VCS working copy.
 *
 * SVN is checked alongside Git at every directory level instead of falling
 * back after Git lookup. This matters when an SVN working copy lives inside a
 * Git-managed parent directory: codeDiff must use `vcsType=svn` for files in
 * that working copy rather than inheriting the outer Git repository.
 *
 * Exported for unit testing.
 */
export declare function findVcsRoot(startPath: string): VcsRoot | undefined;
/**
 * Git-only compatibility helper retained for existing tests/callers.
 */
export declare function findRepoRoot(startPath: string): string | undefined;
/**
 * Strip credentials from a git remote URL. Mirrors the logic used by
 * VCSEventProcessor so that both paths produce identical `repoUrl`
 * values downstream.
 *
 * Exported for unit testing.
 */
export declare function clearSensitiveData(gitUrl: string): string;
