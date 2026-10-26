import { Session } from '../../vendor/cbc-core/node/index.js';
import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { AbTestService } from '@genie/product';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { A2aAgentRegistry, A2aDiscoveryReadyService } from '../a2a/a2a-protocol';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const A2AGetAgentCardParameters: z.ZodObject<{
    agent_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    agent_id: string;
}, {
    agent_id: string;
}>;
/**
 * A2AGetAgentCard — resolve one outbound A2A agent by its stable `agent_id`
 * and return its full Agent Card (issue #99451; id-only addressing per issue
 * #114840). The available agents are advertised in this tool's description
 * (`<available_A2A_agents>`, each line prefixed with its `[id]`), populated
 * dynamically at render time from the process-global `A2aAgentRegistry` (see
 * the `A2A_GET_AGENT_CARD` case in tool-manager.ts). The registry is filled by
 * lazy discovery against `CODEBUDDY_REMOTE_AGENTS_URL` (see
 * `A2aDiscoveryReadyService`) plus a background startup trigger and a bounded
 * first-run prewait, so the block reflects the currently authorized agents
 * with no session-startup network cost. The model calls this to get an agent's
 * full skills/interfaces before `A2ASendMessage`; the `agent_id` it passes here
 * is the same one it passes to the send/get/cancel tools.
 *
 * Lookup is an exact `agentId` match (`deriveA2aAgentId` gives distinct ids to
 * distinct endpoints, so it is never ambiguous). A miss returns
 * `AGENT_NOT_FOUND` listing the available `name (id)` pairs.
 *
 * Restricted to the main session, same recursive-delegation guard as the
 * other 3 A2A tools (see `isSubSession` in a2a-tool-guards.ts).
 */
export declare class A2AGetAgentCardTool extends BaseTool implements Tool {
    protected readonly registry?: A2aAgentRegistry;
    protected readonly abTestService?: AbTestService;
    protected readonly discoveryReadyService?: A2aDiscoveryReadyService;
    protected readonly logger: Logger;
    name: ToolNames;
    description: string;
    needsApproval: boolean;
    parameters: z.ZodObject<{
        agent_id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        agent_id: string;
    }, {
        agent_id: string;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    isEnabled: (args: {
        runContext: RunContext<Session>;
    }) => Promise<boolean>;
    execute(input: z.infer<typeof A2AGetAgentCardParameters>, context: RunContext<Session>): Promise<ToolResult>;
}
export {};
