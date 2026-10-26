import { AuthenticationManager } from '@genie/authentication';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { ToolArg, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { AbTestService, ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { type LocalFileFailureCode, type SpaceUploadFailure } from './space-upload';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
/**
 * 把本地单个文件上传为资料库节点（首位接口为 SpaceEngine 公开 View API）。
 *
 * - 读的是**用户本机**的文件，因此文件访问受 workspace / 信任目录 / `--add-dir` 约束，
 *   且软链逃逸在发出任何网络请求之前就会被拒绝（见 `space-upload/local-file-source.ts`）。
 * - 上传后节点保持私有：本工具不设置公开权限，也不生成分享链接（那是 Artifact 的语义）。
 * - 开关见 `ProductFeature.LibraryUpload`（默认关闭）；endpoint 与登录态在 `isEnabled` 里一并校验。
 */
declare const LibraryUploadParameters: z.ZodObject<{
    path: z.ZodString;
    file_name: z.ZodOptional<z.ZodString>;
    parent_id: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    path: string;
    file_name?: string | undefined;
    parent_id?: string | undefined;
}, {
    path: string;
    file_name?: string | undefined;
    parent_id?: string | undefined;
}>;
/** 工具契约错误码（对外稳定，见资料库上传方案 §3.3）。 */
type LibraryUploadErrorCode = LocalFileFailureCode | 'UNAUTHENTICATED' | 'ENDPOINT_UNAVAILABLE' | 'UNSUPPORTED_FILE_TYPE' | 'FILE_TOO_LARGE' | 'CAPACITY_EXCEEDED' | 'CONTENT_BLOCKED' | 'PERMISSION_DENIED' | 'UPLOAD_FAILED' | 'IMPORT_FAILED' | 'IMPORT_STATUS_UNKNOWN' | 'TIMEOUT';
/** 把 `space-upload` 的失败映射成工具契约错误码与用户文案（导出以便表驱动测试）。 */
export declare function mapUploadFailure(failure: SpaceUploadFailure): {
    code: LibraryUploadErrorCode;
    retryable: boolean;
    message: string;
};
export declare class LibraryUploadTool extends BaseTool implements Tool {
    protected readonly authManager: AuthenticationManager;
    protected readonly productManager: ProductManager;
    protected readonly abTestService?: AbTestService;
    protected readonly logger: Logger;
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{
        path: z.ZodString;
        file_name: z.ZodOptional<z.ZodString>;
        parent_id: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        path: string;
        file_name?: string | undefined;
        parent_id?: string | undefined;
    }, {
        path: string;
        file_name?: string | undefined;
        parent_id?: string | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    isEnabled: () => Promise<boolean>;
    resolveNeedPermissionArgs(_runContext: RunContext, input: z.infer<typeof LibraryUploadParameters>, _callId?: string): ToolArg[];
    /**
     * Auto mode classifier projection：文件路径 + 「持久化上传到资料库」的目的。
     * 文件内容不进投影（大文件无法在分类器里展开）。
     */
    toAutoClassifierInput(input: unknown): string;
    execute(input: z.infer<typeof LibraryUploadParameters>, _context: RunContext<Session>): Promise<ToolResult>;
}
export {};
