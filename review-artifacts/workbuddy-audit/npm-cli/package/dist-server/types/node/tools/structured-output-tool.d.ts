/**
 * StructuredOutput Tool
 *
 * This tool allows the model to return structured data in a specific format
 * when --json-schema is provided. The model should call this tool exactly once
 * at the end of its response to provide the structured output.
 *
 * The tool's parameters are dynamically generated based on the user-provided
 * JSON Schema, allowing the model to see the exact structure expected.
 */
import { Session } from '../../vendor/cbc-core/node/index.js';
import { Agent, RunContext, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
export declare class StructuredOutputTool extends BaseTool implements Tool {
    name: ToolNames;
    readonly promptCacheStability: "volatile";
    protected readonly logger: Logger;
    private ajv;
    private compiledValidator;
    private currentSchema;
    /**
     * Dynamic parameters generator
     * Returns the user-provided JSON Schema from --json-schema option directly,
     * or a default flexible schema if not provided.
     */
    parameters: () => Promise<any>;
    argumentRenderer: ToolCallArgumentRenderer;
    /**
     * This tool is only enabled when --json-schema option is provided.
     * This replaces the disallowedTools logic in the interceptor.
     */
    isEnabled: ({ runContext }: {
        runContext: RunContext<Session>;
        agent: Agent;
    }) => boolean;
    /**
     * This tool does not need approval - it's a passive data capture tool
     */
    needsApproval: boolean;
    execute(input: Record<string, unknown>, context?: RunContext<Session>): Promise<ToolResult>;
}
