/**
 * Git safety checks for PowerShell commands.
 *
 * Git can be weaponized for sandbox escape via two vectors:
 * 1. Bare-repo attack: if cwd contains HEAD + objects/ + refs/ but no valid
 *    .git/HEAD, Git treats cwd as a bare repository and runs hooks from cwd.
 * 2. Git-internal write + git: a compound command creates HEAD/objects/refs/
 *    hooks/ then runs git — the git subcommand executes the freshly-created
 *    malicious hooks.
 *
 * This is a regex-based approximation of Claude Code's AST-based gitSafety.ts.
 * It cannot be as precise without AST parameter binding, but covers the common
 * attack vectors through heuristic command/path analysis.
 *
 * Aligned with Claude Code's gitSafety.ts.
 */
import type { SecurityCheckResult } from './powershell-security';
/**
 * Normalize a PowerShell argument to a canonical path for git-internal matching.
 *
 * Order: structural strips (quotes, backtick escapes, provider prefix),
 * then NTFS per-component trailing-strip (spaces always; dots only if not ./..),
 * then normalize separators, then case-fold.
 */
export declare function normalizeGitPathArg(arg: string): string;
/**
 * True if arg (raw PS arg text) resolves to a git-internal path.
 * Covers both bare-repo paths (hooks/, refs/) and standard-repo paths
 * (.git/hooks/, .git/config).
 */
export declare function isGitInternalPath(arg: string): boolean;
/**
 * True if arg resolves to a path inside .git/ (standard-repo metadata dir).
 * Unlike isGitInternalPath, does NOT match bare-repo-style root-level
 * hooks/, refs/ etc. — those are common project directory names.
 */
export declare function isDotGitPath(arg: string): boolean;
/**
 * Cmdlets that can place a file at a caller-specified path. The
 * git-internal-paths guard checks whether any arg is a git-internal path.
 */
export declare const GIT_SAFETY_WRITE_CMDLETS: Set<string>;
/**
 * External archive-extraction applications that write files to cwd with
 * archive-controlled paths. Archive contents are opaque — any extraction
 * preceding git must ask.
 */
export declare const GIT_SAFETY_ARCHIVE_EXTRACTORS: Set<string>;
/**
 * Check if a compound PowerShell command contains a dangerous git-write pattern.
 *
 * Detects two patterns:
 * 1. Write cmdlet targeting a git-internal path + git command in same compound
 * 2. Archive extraction + git command in same compound (TOCTOU)
 *
 * This is a regex heuristic — it splits the command by statement separators
 * and checks each segment. Less precise than Claude Code's AST-based check
 * but covers the common attack vectors.
 */
export declare function checkGitSafety(command: string): SecurityCheckResult;
