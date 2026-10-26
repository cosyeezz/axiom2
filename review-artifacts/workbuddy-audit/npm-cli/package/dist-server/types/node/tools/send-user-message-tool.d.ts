import { Logger } from '@genie/telemetry';
import { z } from 'zod';
import { RunContext } from '../../vendor/cbc-shared/node/index.js';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { BaseTool } from './base-tool';
import { BriefModeService } from './brief-mode-service';
import { ResolvedAttachment } from './send-user-message-attachments';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
/**
 * SendUserMessage 工具的结构化返回数据（issue #82025，对齐 claude-code）。
 *
 * 挂在 `ToolResult.rawResponse` 上，供 hooks /客户端渲染侧消费。
 */
export interface SendUserMessageOutput {
    /** 面向用户的消息（markdown）。 */
    message: string;
    /** 解析后的附件元信息；无附件时缺省。 */
    attachments?: ResolvedAttachment[];
    /** 工具执行时刻的 ISO 时间戳。 */
    sentAt: string;
}
/**
 * SendUserMessage 工具 —— Agent 面向用户的显式通信通道（Brief 模式，issue #82025）。
 *
 * 对齐 claude-code 的 BriefTool：开启 `--brief` 后作为 Agent 面向用户的主要可见输出通道。
 * 工具常驻工具列表，`isEnabled` 在未开 Brief 模式时隐藏它。
 */
export declare class SendUserMessageTool extends BaseTool implements Tool {
    protected readonly logger: Logger;
    protected readonly briefModeService: BriefModeService;
    name: ToolNames;
    description: string;
    shouldShowInToolSearch: () => boolean;
    parameters: z.ZodObject<{
        message: z.ZodString;
        attachments: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        status: z.ZodEnum<["normal", "proactive"]>;
    }, "strip", z.ZodTypeAny, {
        message: string;
        status: "proactive" | "normal";
        attachments?: string[] | undefined;
    }, {
        message: string;
        status: "proactive" | "normal";
        attachments?: string[] | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    needsApproval: boolean;
    /**
     * Auto mode classifier projection: 面向用户的消息本身即分类相关文本。
     */
    toAutoClassifierInput(input: unknown): string;
    isEnabled: () => boolean;
    execute(input: {
        message: string;
        attachments?: string[];
        status: 'normal' | 'proactive';
    }, _context?: RunContext<Session>): Promise<ToolResult>;
}
