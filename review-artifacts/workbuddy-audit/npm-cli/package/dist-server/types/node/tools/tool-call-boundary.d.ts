import { type ModsToolCall, type Session } from '../../vendor/cbc-core/node/index.js';
import { type FunctionCallItem } from '../../vendor/cbc-shared/node/index.js';
import type { Agent, RunContext } from '@openai/agents';
import type { ToolResult } from './tool-protocol';
/**
 * Official `tool.call`: "Fires when the engine is about to run a tool", once
 * per call. This is that boundary. Each entry that runs a tool for the model
 * (the SDK adapter, a deferred target, a REPL cell's call, a deferred tool the
 * model named directly) calls it once; the execution layer and the MCP proxy
 * never dispatch.
 *
 * The runtime is reached through the cbc-core bridge: the CLI's process bridge
 * or a Server session's scoped bridge. This module imports no assembly code, so
 * any tool module may depend on it without a cycle through `cli/mods-bootstrap`.
 */
export declare function dispatchToolCall<T>(identity: ModsToolCall, run: (input: unknown) => Promise<T>): Promise<T>;
/** Whether a Mods runtime hears tool calls here. */
export declare function hasToolCallHooks(): boolean;
/**
 * The `tool.call` identity of a call the model made in `session`: a subagent's
 * calls carry its id, and the run's interruption aborts the hooks.
 */
export declare function modelToolCall(session: Session | undefined, name: string, input: unknown, callId: string | undefined): ModsToolCall;
export type ToolCallOutcome = Parameters<NonNullable<ModsToolCall['onResult']>>[0];
/** What a hook answered beside the result (`context`, `isError`) rides on the result the model reads. */
export declare function withToolCallOutcome(result: unknown, outcome: ToolCallOutcome | undefined): unknown;
/** `dispatchToolCall` for a model call, with its hooks' outcome applied to the result. */
export declare function dispatchModelToolCall(identity: ModsToolCall, run: (input: unknown) => Promise<unknown>): Promise<unknown>;
/**
 * The `tool.call` identity of a call made through a transport tool
 * (DeferExecuteTool): the target's name and arguments, and how a folded target
 * input travels back through the transport.
 */
export interface ToolCallTarget {
    readonly name: string;
    readonly input: unknown;
    readonly transport: (folded: unknown) => unknown;
}
/**
 * Whether this call's approval moves inside its `tool.call` continuation, so the
 * hook, PreToolUse and tool.check run before anyone is asked (Claude Code's order).
 * True whenever a `tool.call` bridge is installed: the Server's scoped bridge and
 * the command line's Mods runtime alike. Recorded per call for `invoke`.
 */
export declare function deferApprovalToContinuation(context: RunContext, callId: string | undefined, always?: boolean): boolean;
/**
 * Whether `invoke` approves this call in its continuation: `needsApproval` left it
 * there, or a `tool.call` bridge is installed now. Otherwise the SDK approved the
 * call itself. A bridge installed in between asks twice rather than not at all.
 */
export declare function approvesInContinuation(context: RunContext, callId: string | undefined, always?: boolean): boolean;
/**
 * Asks inside the continuation. Resolves undefined when the call may run, or to
 * the result it returns instead. The Server's scoped bridge waits on its Host
 * (`requestHostToolApproval`); the command line asks the same channels an SDK
 * interruption does (`requestInlineToolApproval`).
 */
export declare function approveInContinuation(session: Session, toolCall: FunctionCallItem, agent: Agent): Promise<ToolResult | undefined>;
/**
 * After an inline rejection, what a later call of the same step returns instead
 * of running. The Server's scoped bridge approves through its Host and never
 * rejects inline.
 */
export declare function skippedAfterInlineRejection(session: Session): ToolResult | undefined;
