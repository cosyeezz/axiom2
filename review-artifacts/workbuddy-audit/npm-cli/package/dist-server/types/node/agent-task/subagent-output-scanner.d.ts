/**
 * Subagent output scanning — 自研规则集（Claude Code 客户端无对应机制）。
 *
 * A subagent may have read files, web pages, or command output the user never
 * reviewed; text from those sources can carry instructions aimed at the main
 * conversation. Before the main agent reads a subagent's final report, we apply
 * three classes of defensive, non-destructive handling:
 *
 * - **flag** — permission/settings-shaped mentions get a marker line but the
 *   text stays as written;
 * - **neutralize** — text imitating harness/control output gets a backslash
 *   inserted so it reads as ordinary text, and the match is reported;
 * - **neutralize-silent** — conversation-role line imitations are defanged the
 *   same way without being reported.
 *
 * Rules:
 *
 *   1. settings file paths (`.codebuddy/settings*.json`, `.codebuddy.json`,
 *      `managed-settings.json`) — flag
 *   2. `bypassPermissions` — flag
 *   3. `--dangerously-skip-permissions` — flag
 *   4. `permissions.allow` / `permissions.deny` (dot, bracket, or JSON forms) — flag
 *   5. `<system-reminder>` / `</system-reminder>` tags — neutralize (`<` → `<\`)
 *   6. `<channel ... source=...>` tags — neutralize
 *   7. forged `[harness:` marker prefix at line start — neutralize (`[` → `[\`)
 *   8. `antml:` model-layer tags — neutralize
 *   9. lines starting with `Human:` / `Assistant:` (case-insensitive) — neutralize-silent
 *
 * The marker line:
 *   [harness: subagent output matched instruction-shaped pattern(s): … . <suffix>]
 * The suffix is chosen by what actually matched: when a neutralize-class rule
 * rewrote text it states "Control tags below are neutralized"; when only
 * flag-class rules matched (text passed through unmodified) it makes no such
 * claim.
 *
 * The scan never removes or rewords content, and it doesn't judge intent — a
 * tool call the report leads the model to make still goes through the normal
 * permission checks. It is defense-in-depth, not a substitute for restricting
 * what a subagent can reach. Idempotent: defanged text no longer matches.
 */
export interface ScanSubagentOutputResult {
    /** Possibly-transformed text (backslash insertions + optional marker line). */
    text: string;
    /** Human-readable labels of matched reportable pattern groups (empty = untouched). */
    matched: string[];
}
/**
 * Scan a subagent's final report. Returns the text to hand to the main agent.
 * Idempotent for already-defanged text (a `<\system-reminder` no longer matches
 * the tag pattern, `[\harness:` no longer matches the forgery pattern, and
 * `\Human:` no longer starts the line with the role token).
 */
export declare function scanSubagentOutput(output: string): ScanSubagentOutputResult;
