import type { Agent, RunContext } from '@openai/agents';
/**
 * Every model call of a function tool dispatches `tool.call` once, in the
 * adapter (mods-function-tool.ts). Declarations stay live, unlike the snapshot
 * below: a tool that arrives mid-run is declared on the next model call. The
 * SDK approved and runs the tool of the read that declared the call, so the
 * adapter does too, without reading the tools again.
 */
export declare function dispatchToolCallsForRun(agent: Agent): void;
/** Pin model declarations, while discovery and invocation keep their live policy. */
export declare function snapshotModelToolsForRun(agent: Agent, codeMode?: boolean, renderToolSearch?: (context: RunContext) => Promise<string | undefined>): void;
