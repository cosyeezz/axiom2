import { Session } from '../../vendor/cbc-core/node/index.js';
import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { AbTestService } from '@genie/product';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { A2aAgentRegistry, A2aClientService, A2aDiscoveryReadyService } from '../a2a/a2a-protocol';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const A2ACancelTaskParameters: z.ZodObject<{
    agent_id: z.ZodString;
    task_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    task_id: string;
    agent_id: string;
}, {
    task_id: string;
    agent_id: string;
}>;
/**
 * A2ACancelTask — request cancellation of a previously created A2A task
 * (issue #99451, CloudAgent Phase 1). Cancellation is a best-effort request,
 * not a guarantee per the A2A spec: an already-terminal task cannot be
 * canceled (surfaced as `A2ATaskNotCancelableError`), and the remote agent
 * may still be mid-flight when this call returns.
 *
 * Restricted to the main session, same recursive-delegation guard as
 * `A2ASendMessageTool` (see that tool's doc comment).
 */
export declare class A2ACancelTaskTool extends BaseTool implements Tool {
    protected readonly registry?: A2aAgentRegistry;
    protected readonly client?: A2aClientService;
    protected readonly abTestService?: AbTestService;
    protected readonly discoveryReadyService?: A2aDiscoveryReadyService;
    protected readonly logger: Logger;
    name: ToolNames;
    description: string;
    needsApproval: boolean;
    parameters: z.ZodObject<{
        agent_id: z.ZodString;
        task_id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        task_id: string;
        agent_id: string;
    }, {
        task_id: string;
        agent_id: string;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    isEnabled: (args: {
        runContext: RunContext<Session>;
    }) => Promise<boolean>;
    execute(input: z.infer<typeof A2ACancelTaskParameters>, context: RunContext<Session>): Promise<ToolResult>;
}
export {};
