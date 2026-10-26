import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
/**
 * Tools whose `ask` IS the product (question panel / plan approval), not a
 * permission gate on a side-effect like Write or Bash.
 *
 * REPL already approved the cell for Write/Bash; these still need a nested
 * interruption. Keep this list identical to the permission-service interactive
 * exemption — one predicate, two call sites.
 */
export declare const PRODUCT_INTERACTION_TOOL_NAMES: readonly [ToolNames.ASK_USER_QUESTION, ToolNames.EXIT_PLAN_MODE];
export type ProductInteractionToolName = (typeof PRODUCT_INTERACTION_TOOL_NAMES)[number];
export declare function isProductInteractionTool(name: string | undefined): name is ProductInteractionToolName;
/**
 * Synthetic interruption flag. TUI/ACP dispatch on `rawItem.name`
 * (AskUserQuestion → AskPanel, ExitPlanMode → plan approval). This flag only
 * tells ACP to skip waiting for a `tool_call` update the LLM never sent
 * (the model called REPL, not the nested tool).
 *
 * Do not set `codebuddy.ai/sandboxIntercept` — that renders the sandbox
 * bypass card, not the product UI.
 */
export declare const REPL_NESTED_INTERACTION_META = "codebuddy.ai/replNestedInteraction";
export declare function isReplNestedInteraction(providerData: unknown): boolean;
