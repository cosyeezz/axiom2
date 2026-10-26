/**
 * Parse and evaluate the Claude Code-compatible `if` permission rule syntax
 * on hook definitions:
 *
 *   Bash(git *)      → true when tool === 'Bash' and the Bash command matches 'git *'
 *   Write(*.ts)      → true when tool === 'Write' and the file_path matches '*.ts'
 *   Read             → true when tool === 'Read' (no argument filter)
 *   Bash             → true when tool === 'Bash' regardless of arguments
 *
 * Return `true` when the rule matches (hook should run) or when the tool-level
 * context is not available (tool name missing, non-tool event). Return `false`
 * only when we can definitively say the hook does not apply.
 *
 * Implementation re-uses PermissionUtils.matchCommandRule / matchFileRule so
 * matcher semantics stay consistent with the permission rule engine.
 */
export interface HookIfEvaluationContext {
    toolName?: string;
    toolInput?: Record<string, any> | null;
}
export declare const HookIfRuleUtils: {
    /** Parse the rule into `{ toolName, argPattern }`; returns null when malformed. */
    parse(rule: string): {
        toolName: string;
        argPattern?: string;
    } | null;
    /**
     * Evaluate whether the hook should run given the tool context.
     * `true` means "run the hook"; `false` means "skip".
     */
    matches(rule: string, ctx: HookIfEvaluationContext): boolean;
};
