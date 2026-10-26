import { AuthenticationManager } from '@genie/authentication';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { Agent, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { AbTestService, ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { Tool, ToolResult } from './tool-protocol';
/**
 * Artifact 工具参数：上传本地单个 HTML / Markdown 文件，发布为可分享的公网链接。
 *
 * `existingShareLink` 为空时新建节点；给定既有链接 / nodeId 时覆盖同一节点，
 * 因而 republish 到同一个 URL（语义与「不给标识就是新建」一致）。
 */
declare const ArtifactParameters: z.ZodObject<{
    filePath: z.ZodString;
    existingShareLink: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    filePath: string;
    existingShareLink?: string | undefined;
}, {
    filePath: string;
    existingShareLink?: string | undefined;
}>;
/**
 * 上传失败详情由 `space-upload` 以返回值传递，不落在实例字段：工具是 CellJS 单例，
 * Agents SDK 会在同一轮内并行执行多个工具调用（见 `@openai/agents-core` 的
 * `Promise.all(toolRuns...)`），若用实例字段暂存失败原因，两个并发的 execute()
 * 会互相覆盖对方的诊断信息 / 错误码。
 */
/**
 * Artifact 工具 —— 把本地 HTML / Markdown 发布为可渲染的公网分享链接（issue #81031 更名自 ShareLink）。
 *
 * 当前仅面向国内 / iOA / 内部 endpoint 开启，走【知识空间上传】
 * （/space/api/view/import/*，与 WorkBuddy uploadToKnowledge 对齐）。国际 endpoint 暂不提供：
 * 国际网关缺少 spaceengine 接口，暂不作为 CLI 分享链路。
 *
 * Markdown 由**服务端**渲染成样式化页面（后端按扩展名分流，`.md` 与 `.html` 同为一等公民），
 * 客户端不做任何预渲染，只负责给出正确的 Content-Type。
 *
 * 全程仅用 CBC 自身会话的 access token（authManager.buildAuthHeaders）+
 * productManager.getEndpoint()，无需额外 env / token。
 *
 * 开关见 artifact-common.isArtifactToolEnabled（env 新旧名 → 云端 feature 新旧 key → 缺省开）。
 */
export declare class ArtifactTool extends BaseTool implements Tool {
    protected readonly authManager: AuthenticationManager;
    protected readonly productManager: ProductManager;
    protected readonly abTestService?: AbTestService;
    protected readonly logger: Logger;
    name: ToolNames;
    aliases: string[];
    description: string;
    parameters: z.ZodObject<{
        filePath: z.ZodString;
        existingShareLink: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        filePath: string;
        existingShareLink?: string | undefined;
    }, {
        filePath: string;
        existingShareLink?: string | undefined;
    }>;
    isEnabled: (_args: {
        runContext: RunContext<Session>;
        agent: Agent;
    }) => Promise<boolean>;
    execute(input: z.infer<typeof ArtifactParameters>, _context: RunContext<Session>): Promise<ToolResult>;
    /**
     * 把上传失败转成用户可读结果。
     *
     * 后端已把「文件过大 / 内容审核未通过」明确成业务错误码（见 WorkBuddy `share/facade.ts`
     * 对 56040 / 619610 的 errorCode 回传），这里按同一口径给出精准文案，其余保留通用文案 +
     * 诊断片段，确保任何失败都不会静默。
     *
     * 失败详情由 `space-upload` 以返回值传入，不落在实例字段——工具是单例，
     * 若两次 execute() 并发（Agents SDK 一轮内并行跑多个工具调用），实例字段会被彼此覆盖，
     * 导致一次调用报出另一次调用的错误码/诊断文案。
     */
    private buildFailureResult;
    /**
     * 把节点设为「互联网公开可读」（对齐 WorkBuddy `setPublicPermission` 的 public_read→reader）。
     *
     * 后端契约 POST /space/api/permission/set-permission：
     *   body `{ recordId: <nodeId>, public: { role: "reader" } }`，成功判据 code === 0
     *   （见 workbuddy-server `share/facade.ts` setPublicPermission）。
     *
     * markdown 导入的 doc 节点默认私有，必须补这一步分享链接才对外可读。
     * 失败不视为致命错误：返回 `{ ok: false, detail }`，由调用方降级为「链接已生成但可能仍私有」的警告。
     */
    private setPublicRead;
    /** 归一化本地路径（兼容 file:// 与 Windows 盘符）。 */
    private normalizeLocalPath;
}
export {};
