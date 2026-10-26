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
declare const WriteParameters: z.ZodObject<{
    file_path: z.ZodString;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    content: string;
    file_path: string;
}, {
    content: string;
    file_path: string;
}>;
export declare class WriteTool extends SandboxPermissionFileTool implements Tool {
    protected readonly workspace: Workspace;
    protected readonly telemetryService: TelemetryService;
    protected readonly readFileStateService: ReadFileStateService;
    protected readonly codeRatioReportingService?: CodeRatioReportingService;
    protected readonly fileChangeArtifactPublisher?: FileChangeArtifactPublisherContract;
    name: ToolNames;
    aliases: string[];
    parameters: z.ZodObject<{
        file_path: z.ZodString;
        content: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        content: string;
        file_path: string;
    }, {
        content: string;
        file_path: string;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    resolveNeedPermissionArgs(runContext: RunContext, input: z.infer<typeof WriteParameters>, callId?: string): ToolArg[];
    /**
     * Auto mode classifier projection: `${file_path}: ${content}` (strict Claude
     * alignment, decision D1). The full content is intentionally projected — the
     * classifier judges whether the written content is dangerous / a payload.
     */
    toAutoClassifierInput(input: unknown): string;
    /**
     * Map thrown non-ToolExecutionError failures to tool-specific error codes.
     * Sandbox-related failures are kept here so hook manager no longer hard-codes
     * Write-tool message matching.
     */
    resolveThrownErrorCode(error: unknown): string | undefined;
    execute(input: z.infer<typeof WriteParameters>, context: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    /**
     * 将 Write 工具底层异常映射到 2000 段细分错误码。
     * 重点覆盖沙箱 ModifyBackup 失败（pre-tool 或 write 阶段），避免落 99999。
     */
    private classifyWriteError;
    private validateToolParams;
    private checkFileExists;
    private writeFileContent;
    private prepareFileContent;
    private isUtf8Encoding;
    /**
     * Prepend a UTF-8 BOM for new CSV/TSV files so Windows Excel decodes CJK
     * characters correctly (#54660), or re-add the original file's BOM on
     * overwrite (the model-supplied content usually lacks one).
     */
    private shouldWriteUtf8Bom;
    private reportFileAction;
    /**
     * 全文 diff 超时兜底：无法精确到「变化的行」，退化为按整份行数/字符数估算。
     * 新建文件 old 为空 → removed=0；覆盖已有文件视为「删旧全部 + 写新全部」（会把未改动的保留行也计入，数值偏大）。
     * 仅超大文件覆写触发 diff 超时时才走到，极罕见。
     */
    private estimateChangesByLineCount;
}
export {};
