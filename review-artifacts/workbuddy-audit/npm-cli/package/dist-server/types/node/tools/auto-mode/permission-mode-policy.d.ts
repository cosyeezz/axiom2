import { PermissionMode } from '../../../vendor/cbc-shared/node/index.js';
/**
 * Pure, shared judgments about the auto / dontAsk permission modes.
 *
 * Aggregated here so host files don't each re-implement `mode === Auto || mode === DontAsk`.
 * These are the "restricted" modes: they never auto-approve via interruption-layer
 * short-circuits, and sub-agents under them are clamped to a permission ceiling.
 */
/** Modes that must NOT be bypassed by interruption-layer direct-approve short-circuits. */
export { isRestrictedDirectApproveMode } from '../../../vendor/cbc-shared/node/index.js';
/**
 * Whether a parent mode imposes a permission ceiling on sub-agents.
 * Returns the ceiling mode to clamp to, or undefined when no clamp applies.
 */
export declare function permissionCeilingForParent(parentMode: PermissionMode | undefined): PermissionMode | undefined;
/**
 * Denial message shown when a tool is denied solely because mode is dontAsk.
 *
 * Wording aligned with Claude Code 2.1.181 (binary `yBl` + `jIo`): name the tool,
 * surface the reason, then the `jIo` guidance — the agent MAY accomplish the goal
 * with other natural tools but MUST NOT maliciously work around the denial, and
 * should stop + explain to the user if the capability is essential. We also keep
 * CodeBuddy's "add a permission rule" hint (user-helpful, not in conflict).
 * `reason` is the underlying "why this needed approval" text.
 */
export declare function buildDontAskDenyMessage(toolName: string, reason: string): string;
/**
 * Message shown when the auto mode classifier is unavailable AND prompts cannot
 * be shown (non-interactive), so the action is denied fail-closed.
 *
 * Wording aligned with Claude Code 2.1.179 (binary): the classifier is
 * temporarily unavailable, retry later, and read-only operations still work
 * without it.
 */
export declare function buildClassifierUnavailableDenyMessage(toolName: string, reason: string): string;
/**
 * Message shown when the classifier RAN but produced no usable verdict — e.g. a
 * model whose reasoning cannot be disabled spent the whole classifier output
 * budget on hidden thinking and returned nothing parseable.
 *
 * Distinct from `buildClassifierUnavailableDenyMessage` on purpose (Claude keeps
 * the same split: `a9d` for an outage vs `x8s(reason, { refused: false })` for a
 * `parse_failure`): the model is up, so "temporarily unavailable, wait and retry"
 * would be wrong advice. Retrying an unsuitable classifier model reproduces the
 * same empty answer, so the guidance is to stop and let the user pick a model.
 * `reason` already names the model that ran and the setting that changes it.
 */
export declare function buildClassifierNoVerdictDenyMessage(toolName: string, reason: string): string;
/**
 * Message returned to the model when the auto mode classifier BLOCKS an action
 * (a real `deny` verdict, not an outage). Aligned with Claude Code 2.1.196
 * (binary `Qpc`): name the classifier + reason, tell the agent it may keep
 * working on unrelated tasks, then append the shared PERMISSION_DENIED_GUIDANCE
 * — the agent may accomplish the goal via other natural tools but MUST NOT try
 * to bypass the intent of the denial, and if the capability is essential it
 * should STOP and explain to the user and let the user decide.
 *
 * Without this guidance the deny result is a bare "denied" line, and some models
 * fill the gap by popping an AskUserQuestion "shall I run it anyway?" prompt —
 * effectively a one-click override of a SOFT BLOCK. The guidance steers the model
 * toward explaining and deferring to the user instead of soliciting a rubber-stamp.
 */
export declare function buildClassifierDenyMessage(reason: string): string;
