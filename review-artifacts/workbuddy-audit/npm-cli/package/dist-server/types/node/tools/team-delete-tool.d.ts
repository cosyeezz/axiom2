import { Session } from '../../vendor/cbc-core/node/index.js';
import { RunContext, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { Tool, ToolResult } from './tool-protocol';
/**
 * TeamDelete tool - removes team and task directories.
 *
 * Refuses if the team still has truly-active members (i.e. teammates whose
 * `isActive()` returns true: in-process tasks in `running`/`pending` state,
 * or out-of-process backends that have not yet reported finished). Idle /
 * completed teammates do NOT block deletion — they have no in-flight work
 * to lose.
 *
 * The team name is automatically determined from the current session's team context.
 *
 * Behaviour aligned with Claude Code's `TeamDeleteTool` (gh-32730 era):
 * the lead is expected to send `shutdown_request` via SendMessage first,
 * wait for `shutdown_response` (which marks members idle), then call
 * TeamDelete. This prevents accidentally killing teammates mid-task.
 */
export declare class TeamDeleteTool extends BaseTool implements Tool {
    protected readonly logger: Logger;
    name: ToolNames;
    description: string;
    /**
     * Keep deferred-tool discovery aligned with the runtime feature gate.
     * Otherwise TeamDelete remains visible in ToolSearch after Agent Teams is disabled.
     */
    shouldShowInToolSearch: () => boolean;
    parameters: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
    needsApproval: boolean;
    isEnabled: () => boolean;
    private isAgentTeamsEnabled;
    execute(_input: Record<string, never>, context?: RunContext<Session>): Promise<ToolResult>;
}
