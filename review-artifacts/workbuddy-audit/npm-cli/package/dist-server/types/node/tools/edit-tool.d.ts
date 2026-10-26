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
declare const EditParameters: z.ZodObject<{
    file_path: z.ZodString;
    old_string: z.ZodString;
    new_string: z.ZodString;
    replace_all: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    file_path: string;
    new_string: string;
    old_string: string;
    replace_all: boolean;
}, {
    file_path: string;
    new_string: string;
    old_string: string;
    replace_all?: boolean | undefined;
}>;
export declare class EditTool extends SandboxPermissionFileTool implements Tool {
    protected readonly workspace: Workspace;
    protected readonly readFileStateService: ReadFileStateService;
    protected readonly telemetryService: TelemetryService;
    protected readonly codeRatioReportingService?: CodeRatioReportingService;
    protected readonly fileChangeArtifactPublisher?: FileChangeArtifactPublisherContract;
    name: ToolNames;
    aliases: string[];
    parameters: z.ZodObject<{
        file_path: z.ZodString;
        old_string: z.ZodString;
        new_string: z.ZodString;
        replace_all: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    }, "strip", z.ZodTypeAny, {
        file_path: string;
        new_string: string;
        old_string: string;
        replace_all: boolean;
    }, {
        file_path: string;
        new_string: string;
        old_string: string;
        replace_all?: boolean | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    resolveNeedPermissionArgs(_runContext: RunContext, input: z.infer<typeof EditParameters>, _callId?: string): ToolArg[];
    /**
     * Auto mode classifier projection: `${file_path}: ${new_string}` (strict
     * Claude alignment, decision D1) — the new content is what the classifier
     * inspects for a dangerous payload.
     */
    toAutoClassifierInput(input: unknown): string;
    execute(input: z.infer<typeof EditParameters>, context: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    /**
     * 兜底来自 IO 操作（writeFileContent / readFileContent 等）的普通 Error：这类异常常丢失
     * errno，故同时按 errno 与 message 关键词识别。applyTextReplacement 抛的带码
     * ToolExecutionError 由 execute 原样透传，不进入此方法。
     * 优先级：无内容变更(4004) → 多重匹配(4008) → 路径不存在(4012) →
     * 权限(4013) → 未匹配(4003) → 沙箱(4014) → 空指针 crash(4015) → 兜底(4000)。
     */
    private classifyEditError;
    /**
     * 校验参数，失败时抛出带细分错误码的 ToolExecutionError：
     * - zod 失败 / 空路径 → InvalidParameterError(90000)
     * - old==new（无变更）→ ReplaceNoContentChangedError(4004)
     * - 新建文件逃生口：old_string==='' 且文件不存在 → 放行（当 Write 用）
     * 直接抛而非返回字符串，避免各场景被统一压成 90000，无法在监控聚合中区分。
     */
    private validateToolParams;
    private countOccurrences;
    private resolveFilePath;
    private isUtf8Encoding;
    private reportFileAction;
}
export {};
