import { type FunctionCallItem } from '../../vendor/cbc-shared/node/index.js';
import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { AgentService } from '../agent';
import { ImageBlobService } from '../blob-store';
import { SensitiveToolEgressGuard } from '../sensitive-content/sensitive-content-protocol';
import { type Session, SessionFactory } from '../session';
import { BaseTool } from './base-tool';
import { type ShellStreamPusherService } from './shell-stream-pusher';
import { Tool, ToolArg, ToolCallArgumentRenderer, ToolNames, ToolPermissionType, ToolResult } from './tool-protocol';
declare const ViewImageParameters: z.ZodObject<{
    image_path: z.ZodEffects<z.ZodString, string, string>;
    query: z.ZodEffects<z.ZodString, string, string>;
}, "strip", z.ZodTypeAny, {
    query: string;
    image_path: string;
}, {
    query: string;
    image_path: string;
}>;
export declare class ViewImageTool extends BaseTool implements Tool {
    protected readonly logger: Logger;
    protected readonly agentService: AgentService;
    protected readonly sessionFactory: SessionFactory;
    protected readonly streamPusher?: ShellStreamPusherService;
    protected readonly imageBlobService: ImageBlobService;
    protected readonly productManager: ProductManager;
    protected readonly sensitiveToolEgressGuard?: SensitiveToolEgressGuard;
    /** Successful descriptions, populated by this tool and isolated by session and filesystem. */
    private readonly relayCaches;
    name: ToolNames;
    parameters: z.ZodObject<{
        image_path: z.ZodEffects<z.ZodString, string, string>;
        query: z.ZodEffects<z.ZodString, string, string>;
    }, "strip", z.ZodTypeAny, {
        query: string;
        image_path: string;
    }, {
        query: string;
        image_path: string;
    }>;
    readonly permissionRestrictionNames: ToolNames[];
    argumentRenderer: ToolCallArgumentRenderer;
    resolveToolType(): ToolPermissionType;
    resolveNeedPermissionArgs(_context: RunContext, input: z.infer<typeof ViewImageParameters>): ToolArg[];
    toAutoClassifierInput(input: unknown): string;
    execute(input: z.infer<typeof ViewImageParameters>, context: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    private resolveImagePath;
    private describeWithVisionModel;
    /**
     * 读图进度心跳：把"正在问什么 + 已等多久"推到工具卡片上。
     *
     * 只做展示，不影响调用本身；没有 callId（非模型发起的调用）或推流服务不可用时静默跳过。
     */
    private startVisionProgress;
    private createVisionContext;
    private relayCache;
    private prepareImageDataUrl;
    private budgetError;
    private textResult;
    private errorResult;
}
export {};
