import { Session } from '../../vendor/cbc-core/node/index.js';
import { type FunctionCallItem, ToolArg, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { Workspace } from '@genie/runtime';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { CodeRatioReportingService } from '../code-ratio';
import { TelemetryService } from '../telemetry';
import { type FileChangeArtifactPublisher as FileChangeArtifactPublisherContract } from './file-change-artifact-publisher';
import { SandboxPermissionFileTool } from './sandbox-permission-file-tool';
import { ReadFileStateService, Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const MultiEditFileParameters: z.ZodObject<{
    file_path: z.ZodString;
    edits: z.ZodArray<z.ZodObject<{
        old_string: z.ZodString;
        new_string: z.ZodString;
        replace_all: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    }, "strip", z.ZodTypeAny, {
        new_string: string;
        old_string: string;
        replace_all: boolean;
    }, {
        new_string: string;
        old_string: string;
        replace_all?: boolean | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    file_path: string;
    edits: {
        new_string: string;
        old_string: string;
        replace_all: boolean;
    }[];
}, {
    file_path: string;
    edits: {
        new_string: string;
        old_string: string;
        replace_all?: boolean | undefined;
    }[];
}>;
export declare class MultiEditTool extends SandboxPermissionFileTool implements Tool {
    protected readonly workspace: Workspace;
    protected readonly telemetryService: TelemetryService;
    protected readonly readFileStateService: ReadFileStateService;
    protected readonly codeRatioReportingService?: CodeRatioReportingService;
    protected readonly fileChangeArtifactPublisher?: FileChangeArtifactPublisherContract;
    name: ToolNames;
    aliases: string[];
    parameters: z.ZodObject<{
        file_path: z.ZodString;
        edits: z.ZodArray<z.ZodObject<{
            old_string: z.ZodString;
            new_string: z.ZodString;
            replace_all: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
        }, "strip", z.ZodTypeAny, {
            new_string: string;
            old_string: string;
            replace_all: boolean;
        }, {
            new_string: string;
            old_string: string;
            replace_all?: boolean | undefined;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        file_path: string;
        edits: {
            new_string: string;
            old_string: string;
            replace_all: boolean;
        }[];
    }, {
        file_path: string;
        edits: {
            new_string: string;
            old_string: string;
            replace_all?: boolean | undefined;
        }[];
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    resolveNeedPermissionArgs(_runContext: RunContext, input: z.infer<typeof MultiEditFileParameters>, _callId?: string): ToolArg[];
    /**
     * Auto mode classifier projection: `${file_path}: ${all new_strings}` (Claude
     * Edit-content alignment, decision D1) — every edit's new content is inspected
     * for a dangerous payload.
     */
    toAutoClassifierInput(input: unknown): string;
    /**
     * 多步编辑的核心逻辑，顺序应用所有编辑操作
     * 所有编辑操作是原子性的 - 要么全部成功，要么全部失败
     * 每个编辑操作都在前一个编辑的结果上进行
     */
    private applyMultiEdits;
    /**
     * 计算多步编辑的最终结果
     * 验证所有编辑操作的有效性，并计算最终的文件内容
     */
    private calculateMultiEdit;
    /**
     * 执行多步编辑操作
     * 原子性操作：要么所有编辑都成功应用，要么全部回滚
     */
    execute(params: z.infer<typeof MultiEditFileParameters>, context: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    private classifyReadError;
    private isUtf8Encoding;
    private reportFileAction;
}
export {};
