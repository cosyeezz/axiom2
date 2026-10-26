/**
 * `codebuddy-code` — public type surface for mod authors.
 *
 * At runtime, cbc's mod loader `external`izes `codebuddy-code` (see
 * `packages/cbc-plugins/src/node/mods/loader/load-mod.ts`) — nothing
 * from this file ships in the bundled mod. It exists purely so a
 * `.ts` / `.tsx` mod source can write:
 *
 *   ```ts
 *   import type { On } from 'codebuddy-code';
 *   ```
 *
 * and have the IDE resolve `On`, `Hook`, `EventInput`, `EventResult`,
 * etc. against the real definitions in `types/events.ts`. The runtime
 * shim (`__cbcH`, tag constants) is separate — injected by esbuild via
 * a virtual module at load time, so there's no runtime import needed
 * for JSX either.
 *
 * ## What we deliberately re-export
 *
 * Only the names the architecture doc §3 / §5 / §6 documents. Runtime
 * internals (RenderRegistry, dispatch, RuntimeHost, …) are `@genie/`
 * -private; a mod that reaches for them isn't a mod, it's a fork.
 */
export type * from './types/events';
export type { On, Register, Registration, Tier, TargetTier, PluginOptions, EventName, EngineEventName, OpEventName, ClassicHookEvent, ClassicEventName, Namespace, Glob, Negation, Pattern, Matcher, MatcherValue, Hook, Next, CaughtNext, CatchHandler, NextBudget, HookBudget, HookFailure, Origin, EventInput, EventInputBase, EventResult, TraceOutcome, TraceEntry, Args, ResultOf, PaneOpenArgs, UiAskOptions, SessionCompactInput, SessionCompactResult, ResolvedElements, JsxElement, Timer, SessionMessage, ToolSpec, CommandSpec, BuiltinToolCallInput, BuiltinToolCallInputFallback, BuiltinToolInputs, BuiltinToolName, BuiltinToolResults, McpToolCallInput, ToolAgentLoop, ToolCallArgs, ToolCallEnvelope, ToolCallInput, ToolCallOverloads, ToolCallReserved, ToolCallResult, ToolCheckArgs, ToolCheckDecision, ToolCheckInput, ToolCheckResult, ToolDeferral, ToolDescribeInput, ToolDescribeResult, ToolInfo, ToolNamed, ToolRegisterResult, ToolResultOf, ToolResultSummary, ToolUseSummary, EventInputMap, EventResultMap, HttpInit, HttpResponse, ProcessRunInit, ProcessRunResult, FsAncestor, FsAncestorPart, FsAncestorsRequest, Settings, SettingsSource, SettingsReadArgs, InvalidatableEventName, SessionAuthorization, PluginRegisterInput, PluginRegisterUses, EngineCreateInput, ClassicResult, HooksModule, } from './types/events';
/**
 * `$` — the engine capability surface passed as the first argument to
 * every hook. Includes `ui.*`, `store.*`, `http.*`, `process.*`,
 * `session.*`, and helpers like `deny` / `value`.
 */
export type { EngineInterface as $ } from './types/events';
//# sourceMappingURL=public-types.d.ts.map