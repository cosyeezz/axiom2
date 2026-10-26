import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { CodeRatioReportingService } from '../code-ratio';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { TelemetryService } from '../telemetry';
import { SandboxPermissionFileTool } from './sandbox-permission-file-tool';
import { ReadFileStateService, Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
import { ToolArg } from '../../vendor/cbc-shared/node/index.js';
declare const NotebookEditParameters: z.ZodObject<{
    notebook_path: z.ZodString;
    cell_id: z.ZodOptional<z.ZodString>;
    new_source: z.ZodString;
    cell_type: z.ZodOptional<z.ZodEnum<["code", "markdown"]>>;
    edit_mode: z.ZodDefault<z.ZodOptional<z.ZodEnum<["replace", "insert", "delete"]>>>;
}, "strip", z.ZodTypeAny, {
    notebook_path: string;
    edit_mode: "replace" | "delete" | "insert";
    new_source: string;
    cell_id?: string | undefined;
    cell_type?: "code" | "markdown" | undefined;
}, {
    notebook_path: string;
    new_source: string;
    cell_id?: string | undefined;
    cell_type?: "code" | "markdown" | undefined;
    edit_mode?: "replace" | "delete" | "insert" | undefined;
}>;
export declare class NotebookEditTool extends SandboxPermissionFileTool implements Tool {
    protected readonly telemetryService: TelemetryService;
    protected readonly readFileStateService: ReadFileStateService;
    protected readonly codeRatioReportingService?: CodeRatioReportingService;
    name: string;
    aliases: string[];
    description: string;
    parameters: z.ZodObject<{
        notebook_path: z.ZodString;
        cell_id: z.ZodOptional<z.ZodString>;
        new_source: z.ZodString;
        cell_type: z.ZodOptional<z.ZodEnum<["code", "markdown"]>>;
        edit_mode: z.ZodDefault<z.ZodOptional<z.ZodEnum<["replace", "insert", "delete"]>>>;
    }, "strip", z.ZodTypeAny, {
        notebook_path: string;
        edit_mode: "replace" | "delete" | "insert";
        new_source: string;
        cell_id?: string | undefined;
        cell_type?: "code" | "markdown" | undefined;
    }, {
        notebook_path: string;
        new_source: string;
        cell_id?: string | undefined;
        cell_type?: "code" | "markdown" | undefined;
        edit_mode?: "replace" | "delete" | "insert" | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    resolveNeedPermissionArgs(_runContext: RunContext, input: z.infer<typeof NotebookEditParameters>, _callId?: string): ToolArg[];
    /**
     * Auto mode classifier projection: `${notebook_path} ${edit_mode}: ${new_source}`
     * (strict Claude alignment, decision D1) — the new cell source is inspected
     * for a dangerous payload.
     */
    toAutoClassifierInput(input: unknown): string;
    private validateToolParams;
    private readNotebookFile;
    private createNewNotebook;
    private writeNotebookFile;
    private findCellIndexById;
    private generateCellId;
    private createNewCell;
    private normalizeSource;
    execute(params: z.infer<typeof NotebookEditParameters>, _context: RunContext<Session>): Promise<ToolResult>;
    /** 把 ipynb 的 cell source（string | string[]）还原为字符串。ipynb 约定每行已含结尾 '\n'，join('') 即原文。 */
    private sourceToString;
    private reportFileAction;
}
export {};
