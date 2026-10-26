import type { ToolResult } from './tool-protocol';
/**
 * Guard for tool calls that arrive missing a required argument (#122973).
 *
 * Builtin tools expose their `parameters` as a **JSON Schema** to the
 * `@openai/agents-core` runner. That runner validates required fields **only for
 * Zod** schemas; for a JSON Schema it just `JSON.parse`s the arguments and does
 * no required-field check. So a model that emits a tool call missing a required
 * field lets `undefined` flow into tool code that assumes a string (e.g.
 * `command.split(...)` inside PowerShell security checks), which throws and is
 * surfaced as `Failed to run function tools` → JSON-RPC -32603 → user error 10000.
 *
 * These helpers let us enforce required fields one layer above the runner — in
 * our own tool-wrapping code — instead of patching the vendored SDK.
 */
/**
 * Return the required keys that are missing (or `undefined`) in `input`.
 *
 * Fail-open by design: a non-object schema, a missing/non-array `required`, or a
 * `$ref`/`definitions`-wrapped schema all return `[]` (no enforcement), so
 * well-formed calls and unusual schema shapes are never disturbed.
 */
export declare function findMissingRequiredArgs(parameters: unknown, input: unknown): string[];
/**
 * Graceful, model-visible result for a tool call missing required argument(s).
 * Mirrors the shape tools already use for errors so the model can self-heal by
 * retrying with valid arguments instead of the whole turn aborting.
 */
export declare function missingRequiredArgsResult(toolName: string, missing: string[]): ToolResult;
interface GuardableToolOptions {
    name?: unknown;
    parameters?: unknown;
    execute?: unknown;
    needsApproval?: unknown;
}
/**
 * Wrap a tool's `execute` and `needsApproval` so a call missing a required
 * argument is rejected gracefully before any tool logic runs:
 *  - `execute` returns {@link missingRequiredArgsResult} instead of invoking the
 *    tool with `undefined` (which would crash unguarded tools).
 *  - `needsApproval` returns `false` (skips the permission logic, which itself
 *    parses the args and can crash) — the execute guard then returns the error.
 *
 * Mutates and returns the same options object (matches how buildTools spreads a
 * clone before handing it to the agents-core `tool()` factory). No-op for tools
 * whose schema has no enforceable `required` (fail-open).
 */
export declare function guardToolRequiredArgs<T extends GuardableToolOptions>(toolOptions: T): T;
export {};
