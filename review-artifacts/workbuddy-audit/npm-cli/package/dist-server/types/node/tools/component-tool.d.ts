import type { Session } from '../../vendor/cbc-core/node/index.js';
import { type RunContext, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { Tool, type ToolResult } from './tool-protocol';
export declare class ComponentTool extends BaseTool implements Tool {
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{
        action: z.ZodEnum<["list", "library", "search", "describe", "compose", "classify", "contract", "examples", "saveExample", "get", "save", "validate", "preview", "publish", "instantiate", "enable", "delete", "viewList", "viewGet", "viewAction", "dropView"]>;
        id: z.ZodOptional<z.ZodString>;
        request: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        action: "search" | "list" | "describe" | "delete" | "get" | "compose" | "save" | "enable" | "classify" | "validate" | "contract" | "examples" | "preview" | "library" | "viewList" | "viewGet" | "viewAction" | "dropView" | "publish" | "instantiate" | "saveExample";
        id?: string | undefined;
        request?: Record<string, unknown> | undefined;
    }, {
        action: "search" | "list" | "describe" | "delete" | "get" | "compose" | "save" | "enable" | "classify" | "validate" | "contract" | "examples" | "preview" | "library" | "viewList" | "viewGet" | "viewAction" | "dropView" | "publish" | "instantiate" | "saveExample";
        id?: string | undefined;
        request?: Record<string, unknown> | undefined;
    }>;
    private readonly runtime;
    private readonly settings;
    isEnabled: ({ runContext }: {
        runContext: RunContext<Session>;
    }) => Promise<boolean>;
    needsApproval: (_context: RunContext<Session>, input: unknown) => Promise<boolean>;
    execute(input: z.infer<ComponentTool['parameters']>, context?: RunContext<Session>): Promise<ToolResult>;
}
