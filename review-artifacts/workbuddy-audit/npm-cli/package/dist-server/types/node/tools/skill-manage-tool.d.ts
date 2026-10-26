import { Session } from '../../vendor/cbc-core/node/index.js';
import { Agent, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const SkillManageParameters: z.ZodObject<{
    action: z.ZodEnum<["list", "create", "modify", "delete"]>;
    name: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    action: "list" | "delete" | "create" | "modify";
    name?: string | undefined;
}, {
    action: "list" | "delete" | "create" | "modify";
    name?: string | undefined;
}>;
export declare class SkillManageTool extends BaseTool implements Tool {
    protected readonly productManager: ProductManager;
    protected readonly logger: Logger;
    private lastLoggedEnabled?;
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{
        action: z.ZodEnum<["list", "create", "modify", "delete"]>;
        name: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        action: "list" | "delete" | "create" | "modify";
        name?: string | undefined;
    }, {
        action: "list" | "delete" | "create" | "modify";
        name?: string | undefined;
    }>;
    needsApproval: boolean;
    argumentRenderer: ToolCallArgumentRenderer;
    /**
     * Controlled by ProductFeature.SkillManage.
     * Disabled by default; can be enabled via product config or client settings.
     */
    isEnabled: (_args: {
        runContext: RunContext<Session>;
        agent: Agent;
    }) => Promise<boolean>;
    execute(input: z.infer<typeof SkillManageParameters>, context: RunContext<Session>): Promise<ToolResult>;
    private handleList;
    private handleCreate;
    private handleModify;
    private handleDelete;
    /**
     * Read the agent-created-skills.json registry file.
     * Returns empty registry if file doesn't exist or is malformed.
     */
    private readRegistry;
    /**
     * Check if a skill name exists in the registry file.
     */
    private isInRegistry;
    /**
     * Check if a skill's SKILL.md file contains `agent_created: true` in frontmatter.
     */
    private hasAgentCreatedFrontmatter;
    /**
     * Dual validation: checks both the registry file and SKILL.md frontmatter.
     * Either source confirming agent-created is sufficient (fault-tolerant design).
     * Returns error message string if validation fails, undefined if OK.
     */
    private validateAgentCreated;
    private findSkillByName;
    private listDirectoryContents;
    private generateSkillTemplate;
    /**
     * Truncate output to MAX_TOOL_OUTPUT_LENGTH to prevent context overflow.
     * Preserves the beginning of the output and appends a truncation marker.
     */
    private truncateOutput;
}
export {};
