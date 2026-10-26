import { Session } from '../../vendor/cbc-core/node/index.js';
import { ToolArg, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { Workspace } from '@genie/runtime';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const NotebookReadParameters: z.ZodObject<{
    notebook_path: z.ZodString;
    cell_id: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    notebook_path: string;
    cell_id?: string | undefined;
}, {
    notebook_path: string;
    cell_id?: string | undefined;
}>;
export declare class NotebookReadTool extends BaseTool implements Tool {
    protected readonly workspace: Workspace;
    name: ToolNames;
    isConcurrencySafe(): boolean;
    aliases: string[];
    parameters: z.ZodObject<{
        notebook_path: z.ZodString;
        cell_id: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        notebook_path: string;
        cell_id?: string | undefined;
    }, {
        notebook_path: string;
        cell_id?: string | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    resolveNeedPermissionArgs(runContext: RunContext, input: z.infer<typeof NotebookReadParameters>, callId?: string): ToolArg[];
    /**
     * 验证工具参数
     */
    private validateToolParams;
    /**
     * 读取和解析 Jupyter notebook 文件
     */
    private readNotebookFile;
    /**
     * 格式化单个 cell 内容
     */
    private formatCell;
    /**
     * 根据 cell_id 查找特定的 cell
     */
    private findCellById;
    /**
     * 执行 notebook 读取操作
     */
    execute(params: z.infer<typeof NotebookReadParameters>, context: RunContext<Session>): Promise<ToolResult>;
}
export {};
