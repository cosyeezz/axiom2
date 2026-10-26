/**
 * Static command-level pre-approval policy, inspired by Codex's `ExecPolicy`
 * (codex-rs/exec-policy/...). See
 * `apps/workbuddy-desktop/docs/refactor/win-cli-sandbox/20-sandbox-exec-policy-plan.md`
 * for the design rationale.
 *
 * The policy returns a bounded decision for every command the
 * {@link SandboxOrchestrator} is about to run:
 *
 * - `allow`     — known-safe command; execute directly via `LocalShellService`
 *                 without sandboxing or any approval UI.
 * - `forbidden` — known-dangerous command; reject synthetically without any
 *                 execution, sandbox attempt, or approval UI.
 * - `prompt`    — no rule matches; fall through to the orchestrator's normal
 *                 `dangerouslyDisableSandbox` / session-cache / sandbox-first
 *                 / escalation pipeline.
 *
 * Matching is prefix-based on argv tokens (see
 * {@link SandboxExecPolicyRule.prefix}). We deliberately avoid Codex's Starlark
 * DSL: prefix matching is simpler, cheap to reason about, and sufficient for
 * the coarse "it's just `ls`" vs "it's `rm -rf /`" buckets we care about.
 */
import type { SandboxExecPolicyMatch, SandboxExecPolicyUserRules } from '@genie/sandbox-cli/sandbox-exec-policy';
/**
 * 裁决与规则形状由 sandbox-cli 的匹配算法持有，本层只转出，避免两侧各存
 * 一份结构等价的定义后静默漂移。
 */
export type { SandboxExecDecision, SandboxExecPolicyMatch, SandboxExecPolicyRule, SandboxExecPolicyUserRules, } from '@genie/sandbox-cli/sandbox-exec-policy';
/** DI symbol for the policy. */
export declare const SandboxExecPolicy: unique symbol;
export interface SandboxExecPolicy {
    /**
     * Classify a raw command string.
     *
     * Compound commands (chained with `&&`, `||`, `;`, or `|`) are split into
     * sub-commands and each sub-command is matched independently. Compound
     * resolution rules:
     *
     *   - Any sub-command forbidden → `forbidden` (forbidden-wins).
     *   - All sub-commands allow    → `allow`.
     *   - Otherwise                       → `prompt` (downgrade to manual review).
     *
     * Unrecognisable shell constructs (command substitution `$(...)`, `eval`,
     * nested `bash -c` scripts that themselves compose commands, etc.) are
     * treated as `prompt`; we refuse to make confident decisions about
     * payloads we can't parse.
     */
    match(command: string): SandboxExecPolicyMatch;
    /**
     * Replace the currently loaded user rules. Called by
     * `BashSandboxManager` whenever `settings.sandbox.execPolicy` changes.
     * Implementations must keep builtin rules unaffected by this call.
     */
    setUserRules(rules: SandboxExecPolicyUserRules | undefined): void;
}
