import { Logger } from '@celljs/core';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { ToolArg, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { Workspace } from '@genie/runtime';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { type SandboxOrchestrator as ISandboxOrchestrator } from '../permission';
import { type SandboxTurnConfig as ISandboxTurnConfig } from '../sandbox-cli/sandbox-turn-config';
import { BaseTool } from './base-tool';
import { type SandboxApprovalRequesterContext } from './bash-sandbox-approval-requester';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const GrepParameters: z.ZodObject<{
    pattern: z.ZodString;
    path: z.ZodOptional<z.ZodString>;
    glob: z.ZodOptional<z.ZodString>;
    output_mode: z.ZodOptional<z.ZodEnum<["content", "files_with_matches", "count"]>>;
    '-B': z.ZodOptional<z.ZodNumber>;
    '-A': z.ZodOptional<z.ZodNumber>;
    '-C': z.ZodOptional<z.ZodNumber>;
    context: z.ZodOptional<z.ZodNumber>;
    '-n': z.ZodOptional<z.ZodBoolean>;
    '-i': z.ZodOptional<z.ZodBoolean>;
    type: z.ZodOptional<z.ZodString>;
    head_limit: z.ZodOptional<z.ZodNumber>;
    offset: z.ZodOptional<z.ZodNumber>;
    multiline: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    pattern: string;
    type?: string | undefined;
    context?: number | undefined;
    path?: string | undefined;
    glob?: string | undefined;
    offset?: number | undefined;
    '-A'?: number | undefined;
    '-B'?: number | undefined;
    '-C'?: number | undefined;
    multiline?: boolean | undefined;
    output_mode?: "content" | "count" | "files_with_matches" | undefined;
    head_limit?: number | undefined;
    '-n'?: boolean | undefined;
    '-i'?: boolean | undefined;
}, {
    pattern: string;
    type?: string | undefined;
    context?: number | undefined;
    path?: string | undefined;
    glob?: string | undefined;
    offset?: number | undefined;
    '-A'?: number | undefined;
    '-B'?: number | undefined;
    '-C'?: number | undefined;
    multiline?: boolean | undefined;
    output_mode?: "content" | "count" | "files_with_matches" | undefined;
    head_limit?: number | undefined;
    '-n'?: boolean | undefined;
    '-i'?: boolean | undefined;
}>;
type GrepParams = z.infer<typeof GrepParameters>;
export declare class GrepTool extends BaseTool implements Tool {
    protected readonly workspace: Workspace;
    protected readonly sandboxTurnConfig: ISandboxTurnConfig;
    protected readonly sandboxOrchestrator: ISandboxOrchestrator;
    protected readonly logger: Logger;
    name: ToolNames;
    isConcurrencySafe(): boolean;
    aliases: string[];
    parameters: z.ZodObject<{
        pattern: z.ZodString;
        path: z.ZodOptional<z.ZodString>;
        glob: z.ZodOptional<z.ZodString>;
        output_mode: z.ZodOptional<z.ZodEnum<["content", "files_with_matches", "count"]>>;
        '-B': z.ZodOptional<z.ZodNumber>;
        '-A': z.ZodOptional<z.ZodNumber>;
        '-C': z.ZodOptional<z.ZodNumber>;
        context: z.ZodOptional<z.ZodNumber>;
        '-n': z.ZodOptional<z.ZodBoolean>;
        '-i': z.ZodOptional<z.ZodBoolean>;
        type: z.ZodOptional<z.ZodString>;
        head_limit: z.ZodOptional<z.ZodNumber>;
        offset: z.ZodOptional<z.ZodNumber>;
        multiline: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        pattern: string;
        type?: string | undefined;
        context?: number | undefined;
        path?: string | undefined;
        glob?: string | undefined;
        offset?: number | undefined;
        '-A'?: number | undefined;
        '-B'?: number | undefined;
        '-C'?: number | undefined;
        multiline?: boolean | undefined;
        output_mode?: "content" | "count" | "files_with_matches" | undefined;
        head_limit?: number | undefined;
        '-n'?: boolean | undefined;
        '-i'?: boolean | undefined;
    }, {
        pattern: string;
        type?: string | undefined;
        context?: number | undefined;
        path?: string | undefined;
        glob?: string | undefined;
        offset?: number | undefined;
        '-A'?: number | undefined;
        '-B'?: number | undefined;
        '-C'?: number | undefined;
        multiline?: boolean | undefined;
        output_mode?: "content" | "count" | "files_with_matches" | undefined;
        head_limit?: number | undefined;
        '-n'?: boolean | undefined;
        '-i'?: boolean | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    resolveNeedPermissionArgs(runContext: RunContext, input: GrepParams, callId?: string): ToolArg[];
    /**
     * Auto mode classifier projection: `${pattern} in ${path}` / `${pattern}`
     * (Claude alignment, decision D1). Grep is in the read-only history set;
     * consulted only when it is the current action being classified.
     */
    toAutoClassifierInput(input: unknown): string;
    execute(input: GrepParams, context: RunContext<Session>, details?: SandboxApprovalRequesterContext['details']): Promise<ToolResult>;
    /**
     * 先归一化支持的字符串参数，再校验。仅在未指定输出模式时，
     * 根据有效的上下文或行号选项推断 content 模式。
     */
    private normalizeGrepParams;
    /** 仅对正则语法错误尝试转义失衡括号，其余错误（路径、权限、超时、中断）保持原样。 */
    private repairRejectedPattern;
    /**
     * 将底层异常映射到 search_content 细分错误码：
     * 权限(EACCES/EPERM) → 7104；路径(ENOENT/ENOTDIR) → 7101；
     * 非法正则(SyntaxError / stderr 含 regex 关键字) → 7102；其余 → 7100。
     */
    private classifyGrepError;
    private resolveSearchPath;
    private performRipgrepSearch;
    private getSandboxRgStreamExecutor;
    private executeRipgrepWithSandboxApproval;
    private formatResult;
    private performSystemGrepSearch;
    private performJavaScriptSearch;
    private get rootDirectory();
}
export {};
