import { Session } from '../../vendor/cbc-core/node/index.js';
import { ToolArg, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { Workspace } from '@genie/runtime';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { ReadFileStateService, Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const ReadParameters: z.ZodObject<{
    file_path: z.ZodString;
    offset: z.ZodOptional<z.ZodNumber>;
    limit: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    file_path: string;
    offset?: number | undefined;
    limit?: number | undefined;
}, {
    file_path: string;
    offset?: number | undefined;
    limit?: number | undefined;
}>;
export declare class ReadTool extends BaseTool implements Tool {
    protected readonly workspace: Workspace;
    protected readonly readFileStateService: ReadFileStateService;
    protected readonly logger: Logger;
    name: ToolNames;
    isConcurrencySafe(): boolean;
    aliases: string[];
    parameters: z.ZodObject<{
        file_path: z.ZodString;
        offset: z.ZodOptional<z.ZodNumber>;
        limit: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        file_path: string;
        offset?: number | undefined;
        limit?: number | undefined;
    }, {
        file_path: string;
        offset?: number | undefined;
        limit?: number | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    resolveNeedPermissionArgs(runContext: RunContext, input: z.infer<typeof ReadParameters>, callId?: string): ToolArg[];
    /**
     * Auto mode classifier projection: the file path (Claude alignment, decision
     * D1). Read is in the read-only history set (dropped from history), so this is
     * only consulted if Read is the current action being classified.
     */
    toAutoClassifierInput(input: unknown): string;
    execute(input: z.infer<typeof ReadParameters>, context: RunContext<Session>): Promise<ToolResult>;
    private validateToolParams;
    private readFileContent;
    private readFileContentStreaming;
    private processFileContent;
    private formatContentWithLineNumbers;
    private readJupyterNotebook;
    private formatJupyterNotebook;
    /**
     * 检查文件是否为图片文件。按 ViewImage 接受的扩展名判断，不区分模型——
     * 图片统一引导到 ViewImage（由它按主模型能力决定返回图片还是文字描述）。
     */
    private isImageFile;
}
export {};
