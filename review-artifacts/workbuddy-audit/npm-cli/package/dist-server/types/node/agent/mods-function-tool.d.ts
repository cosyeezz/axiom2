import type { Agent, RunContext, Tool as AgentTool } from '@openai/agents';
type FunctionTool = Extract<AgentTool, {
    type: 'function';
}>;
/**
 * SDK 0.5.2 has no middleware before needsApproval. Compose its public FunctionTool
 * and invokeFunctionTool APIs: keep policy and approval in the lazy continuation,
 * and the SDK's timeout around actual execution, not time awaiting a person.
 * The SDK's agent_tool_start therefore precedes the hooks and approval: the call is
 * reported started right before the tool runs (see markToolCallStartsInInvoke).
 * DeferExecuteTool only transports its target, which reports the shared call id.
 *
 * Every model call of a wrapped tool dispatches `tool.call` here, once, through
 * `dispatchToolCall`, and is approved inside that continuation on the hook's final
 * input: hook → PreToolUse → tool.check → approval → start → body.
 */
export declare function hostModsFunctionTool(snapshot: FunctionTool, agent: Agent, current: (context: RunContext) => Promise<FunctionTool>, options?: {
    /** false: a transport behind the run catalog; its target's adapter dispatches and reports the start. */
    dispatchHook?: boolean;
    deferredTarget?: boolean;
}): FunctionTool;
export {};
