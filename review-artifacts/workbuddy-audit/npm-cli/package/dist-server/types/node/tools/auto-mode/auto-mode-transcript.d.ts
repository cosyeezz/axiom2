import { AgentInputItem } from '../../../vendor/cbc-shared/node/index.js';
/**
 * Serializes session history + the action being classified into the single
 * `<transcript>` text the classifier consumes.
 *
 * Aligned with Claude Code 2.1.181 `whK`/`$Pa` projection (NOT a verbatim dump):
 *
 *  - `user` text          → `User: <text>` (kept — it is the user-intent signal).
 *  - `assistant` text     → DROPPED.
 *  - `tool_result`        → DROPPED, except a non-error result answering a prior
 *                           `AskUserQuestion` → `[User answered AskUserQuestion]: …`
 *                           (the one tool_result Claude keeps, per User Intent #6).
 *  - `tool_use`           → projected via the tool's `toAutoClassifierInput`;
 *                           an empty projection or a read-only history tool
 *                           (`HISTORY_READONLY_TOOLS`) is skipped entirely.
 *
 * Everything is text the model reads as DATA — it never grants permission (the
 * framework system prompt states this explicitly). The last entry is the action
 * being evaluated, appended by the caller via `action`.
 *
 * The per-tool projection is supplied by the caller (`projectToolUse`) so this
 * module stays decoupled from the tool registry; the classifier client owns the
 * `toolName → BaseTool.toAutoClassifierInput` lookup.
 */
/**
 * History tool_use entries for these read-only tools are dropped from the
 * classifier transcript (Claude `$gp`): they add no risk signal and only inflate
 * the prompt. The *current action* is never filtered here — only history.
 */
export declare const HISTORY_READONLY_TOOLS: ReadonlySet<string>;
/**
 * JSONL transcript format toggle (Claude `jsonlTranscript`). Claude defaults to
 * the compact text format; the JSONL variant is a server-flag-only path we do
 * not enable. Kept as a const (not config) so the branch is exercised/visible
 * without introducing an unused product setting (decision D1.3).
 */
export declare const AUTO_MODE_JSONL_TRANSCRIPT = false;
/** The action being classified — projected to its security-relevant text by the caller. */
export interface TranscriptAction {
    toolName: string;
    /** Result of the tool's `toAutoClassifierInput(input)` for this action. */
    projected: string;
}
/**
 * Projects a history tool_use into its classifier text, or `undefined` to skip
 * the entry (empty projection / unknown tool). Read-only history tools are
 * filtered by the serializer before this is consulted.
 */
export type HistoryToolProjector = (toolName: string, toolInput: unknown) => string | undefined;
export declare function serializeTranscript(history: AgentInputItem[], action: TranscriptAction, projectToolUse: HistoryToolProjector): string;
