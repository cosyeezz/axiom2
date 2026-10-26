import { Logger } from '@celljs/core';
import { AgentInputItem, RunContext, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { PromptManager } from '@genie/prompts';
import { Workspace } from '@genie/runtime';
import { EventService } from '@genie/telemetry';
import { z } from 'zod';
import { ShellService } from '../shell';
import { BaseTool } from './base-tool';
import { PlanStorageService } from './plan-storage-service';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const ExitPlanModeParameters: z.ZodObject<{
    allowedPrompts: z.ZodOptional<z.ZodArray<z.ZodObject<{
        tool: z.ZodEnum<["Bash"]>;
        prompt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        prompt: string;
        tool: "Bash";
    }, {
        prompt: string;
        tool: "Bash";
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    allowedPrompts?: {
        prompt: string;
        tool: "Bash";
    }[] | undefined;
}, {
    allowedPrompts?: {
        prompt: string;
        tool: "Bash";
    }[] | undefined;
}>;
export declare class ExitPlanModeTool extends BaseTool implements Tool {
    protected readonly workspace: Workspace;
    protected readonly shellService: ShellService;
    protected readonly promptManager: PromptManager;
    protected readonly planStorageService: PlanStorageService;
    protected readonly eventService: EventService;
    protected readonly logger: Logger;
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{
        allowedPrompts: z.ZodOptional<z.ZodArray<z.ZodObject<{
            tool: z.ZodEnum<["Bash"]>;
            prompt: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            prompt: string;
            tool: "Bash";
        }, {
            prompt: string;
            tool: "Bash";
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        allowedPrompts?: {
            prompt: string;
            tool: "Bash";
        }[] | undefined;
    }, {
        allowedPrompts?: {
            prompt: string;
            tool: "Bash";
        }[] | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    needsApproval: boolean;
    execute(input: z.infer<typeof ExitPlanModeParameters>, context?: RunContext): Promise<ToolResult>;
    /**
     * Teammate ExitPlanMode handler.
     *
     * Teammates spawned with `mode='plan'` cannot exit plan mode unilaterally —
     * the team-lead owns the approval. To avoid deadlocking the parent (who is
     * waiting on the teammate session and the approval UI simultaneously), we:
     *   - Drop a `plan_approval_request` message in the team-lead's inbox.
     *   - Return immediately with a result telling the model the request was sent.
     *   - Leave permission mode untouched **here**. Restoring it is owned by the
     *     response-handling path: `TeamMember.applyPlanApprovalResponses()`
     *     (`agent-team/team-member.ts`) consumes the lead's
     *     `plan_approval_response` and unlocks plan mode on approve (#82046).
     *     Until that response arrives the teammate stays in plan mode, but the
     *     parent spinner is unblocked.
     */
    private handleTeammateExitPlanMode;
    private reportPlanAction;
    resolveRejectedResult(rawItem: AgentInputItem): Promise<AgentInputItem[]>;
}
export {};
