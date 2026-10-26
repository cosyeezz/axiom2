/**
 * Delegate Tool - Executes tools delegated from client-side tool providers
 *
 * This tool enables the agent to invoke tools that are provided by external
 * client-side tool providers (e.g., IDE extensions, plugins). The actual tool
 * execution happens on the client side via the ACP delegateTool extension method.
 */
import { Logger } from '@celljs/core';
import { z } from 'zod';
import { RunContext } from '../../vendor/cbc-shared/node/index.js';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { BaseTool } from './base-tool';
import { Tool, ToolResult } from './tool-protocol';
import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
/**
 * Schema for delegate tool execution
 * Accepts tool ID, input parameters, and optional timeout
 */
declare const DelegateToolSchema: z.ZodObject<{
    toolId: z.ZodString;
    input: z.ZodRecord<z.ZodString, z.ZodAny>;
    timeout: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    input: Record<string, any>;
    toolId: string;
    timeout?: number | undefined;
}, {
    input: Record<string, any>;
    toolId: string;
    timeout?: number | undefined;
}>;
export type DelegateToolInput = z.infer<typeof DelegateToolSchema>;
/**
 * Delegate Tool Implementation
 *
 * This tool is automatically instantiated and registered by DelegateToolManager.
 * It serves as a proxy for executing tools delegated from client-side providers.
 */
export declare class DelegateToolImpl extends BaseTool implements Tool {
    readonly logger: Logger;
    name: ToolNames;
    readonly promptCacheStability: "volatile";
    description: string;
    parameters: z.ZodObject<{
        toolId: z.ZodString;
        input: z.ZodRecord<z.ZodString, z.ZodAny>;
        timeout: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        input: Record<string, any>;
        toolId: string;
        timeout?: number | undefined;
    }, {
        input: Record<string, any>;
        toolId: string;
        timeout?: number | undefined;
    }>;
    needsApproval: boolean;
    /**
     * DelegateTool is always enabled, but only becomes useful when delegate tools are registered
     */
    isEnabled: boolean;
    /**
     * Execute a delegate tool on the client side via ACP extension method
     */
    execute(input: DelegateToolInput, context?: RunContext<Session>): Promise<ToolResult>;
    /**
     * Extract raw response for hook usage
     */
    extractRawResponse(result: ToolResult): unknown;
}
export {};
