import type { Session } from '../../vendor/cbc-core/node/index.js';
/**
 * Marker key on `session.meta` that flags a sub-agent session as having an
 * explicitly-locked plan permission mode (Priority 1 or Priority 2 in
 * `AgentTask.configurePermissionMode`). Only such sub-agents are entitled to
 * own a plan and call `ExitPlanMode` themselves — ones that merely inherit
 * the main session's plan mode (Priority 4) do NOT, because plan approval is
 * owned by the main session in that case.
 *
 * Kept as a string literal (and exported) so both the writer (AgentTask) and
 * the reader (agent-manager visibility gate / tests) reference the same key.
 */
export declare const SUB_AGENT_PLAN_MODE_LOCKED_META_KEY = "subAgentPlanModeLocked";
/**
 * Env switch that disables plan mode (Enter/ExitPlanMode tools) entirely.
 *
 * When set to a truthy value (parsed via `BooleanUtils.isTruthy`), both
 * `EnterPlanMode` and `ExitPlanMode` are hidden from every agent — main and
 * sub alike — so the LLM never sees them and plan approval is never offered.
 * Hosts that want to opt out of plan mode (e.g. embedded scenarios where the
 * approval popup would have nowhere to render) inject this env when launching
 * the CLI.
 *
 * Default is unset (plan mode enabled). Naming follows `CODEBUDDY_DISABLE_*`
 * (cf. `CODEBUDDY_DISABLE_FORK_SUBAGENT`) so the convention stays consistent.
 */
export declare const ENV_DISABLE_PLAN_MODE = "CODEBUDDY_DISABLE_PLAN_MODE";
/**
 * Whether plan mode is disabled in the current process via env
 * `CODEBUDDY_DISABLE_PLAN_MODE` (truthy → disabled).
 *
 * Single source of truth for both visibility gates — agent-manager hides
 * `EnterPlanMode` / `ExitPlanMode` when this returns true, and the same
 * function backs `isExitPlanModeVisibleForSession` below.
 */
export declare function isPlanModeDisabled(): boolean;
/**
 * Decide whether the `ExitPlanMode` tool should appear in this session's tool
 * list when the LLM asks for it.
 *
 * Visibility rules:
 *
 *   0. Env `CODEBUDDY_DISABLE_PLAN_MODE` is truthy: hidden everywhere.
 *      Highest precedence — if the host opted out of plan mode, no agent
 *      ever sees the tool.
 *   1. Main session (no `parentSessionId`): always visible — gating happens
 *      via the user-driven plan mode in product.json, not here.
 *   2. Sub-agent in plan mode AND explicitly locked there (spawned with
 *      `mode: 'plan'` or with an agent-level `permissionMode: 'plan'` in
 *      product.json): visible. ExitPlanMode is the agent's only escape hatch
 *      back to the parent.
 *   3. Sub-agent that merely INHERITED plan mode from the main session
 *      (Priority 4 in `configurePermissionMode`): hidden. Plan approval in
 *      this case is owned by the main session, and exposing the tool would
 *      tempt the LLM to call it — triggering an approval popup that, even if
 *      the user dismisses it, has already polluted the UX. The hard reject in
 *      `ExitPlanModeTool.execute` is a defense-in-depth fallback for the
 *      same case.
 *   4. Sub-agent not in plan mode at all: hidden (irrelevant).
 *
 * @param session The session the LLM is currently running in.
 * @returns `true` if ExitPlanMode should be advertised to the LLM.
 */
export declare function isExitPlanModeVisibleForSession(session: Session): boolean;
