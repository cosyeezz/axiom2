/**
 * Auto mode dangerous-allow-rule filtering.
 *
 * In auto mode, an allow rule that covers a dangerous action (e.g. `Bash(*)`,
 * `Bash(sudo *)`, `PowerShell(iex *)`, `Agent(*)`) would let that action bypass
 * the classifier entirely, defeating auto mode's safety check. We strip such
 * rules from the in-memory rule set for the current permission check, forcing the
 * action through the classifier instead.
 *
 * This never mutates settings on disk — callers pass a copied rule array. We use
 * read-time filtering (not Claude's enter-auto strip + exit-auto restore
 * lifecycle): it is behaviourally equivalent but needs no mutable lifecycle
 * state and cannot leak a stripped rule if an exit path is missed.
 *
 * The danger predicate is a faithful port of Claude Code 2.1.181's
 * `isDangerousClassifierPermission` (`bqe = isDangerousBashPermission ||
 * isDangerousPowerShellPermission || isDangerousTaskPermission`). The command /
 * cmdlet sets below are copied verbatim from the 2.1.181 binary; do NOT trim
 * them — each entry changes which allow rules can bypass the classifier.
 */
/**
 * Whether an allow rule would dangerously bypass the auto classifier
 * (faithful port of Claude `isDangerousClassifierPermission`):
 *   dangerous Bash command || dangerous PowerShell cmdlet || any Agent/Task rule.
 */
export declare function isDangerousAllowRule(rule: string): boolean;
/**
 * Filter out dangerous allow rules that would bypass the auto classifier,
 * returning the kept (safe) rules. If `onRemoved` is provided, it is called once
 * per stripped rule (used by the host to emit a debug log) — keeps logging at the
 * single place that owns this domain rule.
 */
export declare function filterDangerousAllowRules(rules: string[], onRemoved?: (rule: string) => void): string[];
