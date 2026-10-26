import type { Session } from '../../vendor/cbc-core/node/index.js';
import { type RunContext, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { Tool, type ToolResult } from './tool-protocol';
export declare class ModsTool extends BaseTool implements Tool {
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{
        action: z.ZodEnum<["list", "inspectSelf", "inspectList", "inspectQuery", "search", "describe", "searchModules", "describeModule", "contract", "examples", "saveExample", "get", "save", "define", "apply", "undefine", "validate", "run", "stop", "install", "enable", "uninstall", "runtime", "reload", "invoke", "capabilities", "call", "render", "action", "dropView", "callTool", "skinList", "skinContract", "skinSave", "skinApply", "skinDelete", "mount", "updateMount", "unmount"]>;
        id: z.ZodOptional<z.ZodString>;
        request: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        action: "search" | "list" | "describe" | "apply" | "action" | "stop" | "run" | "get" | "runtime" | "call" | "capabilities" | "save" | "install" | "uninstall" | "enable" | "reload" | "render" | "unmount" | "validate" | "contract" | "invoke" | "examples" | "mount" | "callTool" | "updateMount" | "dropView" | "inspectSelf" | "inspectList" | "searchModules" | "describeModule" | "inspectQuery" | "define" | "saveExample" | "undefine" | "skinList" | "skinSave" | "skinApply" | "skinContract" | "skinDelete";
        id?: string | undefined;
        request?: Record<string, unknown> | undefined;
    }, {
        action: "search" | "list" | "describe" | "apply" | "action" | "stop" | "run" | "get" | "runtime" | "call" | "capabilities" | "save" | "install" | "uninstall" | "enable" | "reload" | "render" | "unmount" | "validate" | "contract" | "invoke" | "examples" | "mount" | "callTool" | "updateMount" | "dropView" | "inspectSelf" | "inspectList" | "searchModules" | "describeModule" | "inspectQuery" | "define" | "saveExample" | "undefine" | "skinList" | "skinSave" | "skinApply" | "skinContract" | "skinDelete";
        id?: string | undefined;
        request?: Record<string, unknown> | undefined;
    }>;
    private readonly runtime;
    private readonly views;
    private readonly settings;
    isEnabled: ({ runContext }: {
        runContext: RunContext<Session>;
    }) => Promise<boolean>;
    needsApproval: (_context: RunContext<Session>, input: unknown) => Promise<boolean>;
    execute(input: z.infer<ModsTool['parameters']>, context?: RunContext<Session>): Promise<ToolResult>;
}
