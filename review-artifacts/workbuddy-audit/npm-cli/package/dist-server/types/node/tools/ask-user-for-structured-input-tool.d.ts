import { Session } from '../../vendor/cbc-core/node/index.js';
import { type FunctionCallItem, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { SdkHooksManager } from '../control-signal/control-signal-protocol';
import { ElicitationService } from '../elicitation/elicitation-service';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
/**
 * 是否启用本 tool 的 env 开关。
 * - 缺省 / 空串 / '0' / 'false' 视为关闭；
 * - 其他任意非空值视为开启（与 CBC 其它 `CODEBUDDY_ENABLE_*` 家族保持一致）。
 * 读取放在运行时方法内、每次调用时 live 读，遵循 packages/agent-cli/CODEBUDDY.md
 * 的 prewarm env 契约（禁止模块顶层 / 构造函数固化 per-session env）。
 */
export declare const ASK_STRUCTURED_INPUT_ENV_FLAG = "CODEBUDDY_ENABLE_ASK_USER_FOR_STRUCTURED_INPUT";
export declare function isAskUserForStructuredInputEnvEnabled(): boolean;
declare const AskUserForStructuredInputParameters: z.ZodObject<{
    message: z.ZodString;
    requestedSchema: z.ZodObject<{
        type: z.ZodLiteral<"object">;
        properties: z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        required: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        additionalProperties: z.ZodOptional<z.ZodBoolean>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        type: z.ZodLiteral<"object">;
        properties: z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        required: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        additionalProperties: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        type: z.ZodLiteral<"object">;
        properties: z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        required: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        additionalProperties: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">>;
}, "strip", z.ZodTypeAny, {
    message: string;
    requestedSchema: {
        type: "object";
        properties: Record<string, Record<string, unknown>>;
        required?: string[] | undefined;
        additionalProperties?: boolean | undefined;
    } & {
        [k: string]: unknown;
    };
}, {
    message: string;
    requestedSchema: {
        type: "object";
        properties: Record<string, Record<string, unknown>>;
        required?: string[] | undefined;
        additionalProperties?: boolean | undefined;
    } & {
        [k: string]: unknown;
    };
}>;
export type AskUserForStructuredInputInput = z.infer<typeof AskUserForStructuredInputParameters>;
export declare class AskUserForStructuredInputTool extends BaseTool implements Tool {
    protected readonly elicitationService: ElicitationService;
    protected readonly sdkHooksManager: SdkHooksManager;
    name: ToolNames;
    /**
     * Description 保持精简 + 泛化，只讲"是什么、什么时候用"，不绑定业务场景。
     * 具体场景的用法（例如 MCP 授权征询）通过 `--append-system-prompt` 追加，
     * 详见 `packages/agent-cli/prompts/examples/mcp-auth-elicitation.md`。
     */
    description: string;
    parameters: z.ZodObject<{
        message: z.ZodString;
        requestedSchema: z.ZodObject<{
            type: z.ZodLiteral<"object">;
            properties: z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            required: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            additionalProperties: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            type: z.ZodLiteral<"object">;
            properties: z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            required: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            additionalProperties: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            type: z.ZodLiteral<"object">;
            properties: z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            required: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            additionalProperties: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>;
    }, "strip", z.ZodTypeAny, {
        message: string;
        requestedSchema: {
            type: "object";
            properties: Record<string, Record<string, unknown>>;
            required?: string[] | undefined;
            additionalProperties?: boolean | undefined;
        } & {
            [k: string]: unknown;
        };
    }, {
        message: string;
        requestedSchema: {
            type: "object";
            properties: Record<string, Record<string, unknown>>;
            required?: string[] | undefined;
            additionalProperties?: boolean | undefined;
        } & {
            [k: string]: unknown;
        };
    }>;
    /**
     * Tool 本身就是"征询用户答复"，弹 UI 的语义已经内建在 elicitation/create
     * 上；再走一层 session/request_permission 只会让用户点两次（先"允许"、
     * 再填表单）。与 AskUserQuestion 同款处理：不走审批门。
     */
    needsApproval: boolean;
    argumentRenderer: ToolCallArgumentRenderer;
    /**
     * 门控：env + capability + 可用通道。任一未满足即从模型可见工具列表中移除。
     * 与 AskUserQuestion 保持相同的写法风格，便于日后维护。
     */
    isEnabled: (args: {
        runContext: RunContext<Session>;
    }) => boolean;
    execute(input: AskUserForStructuredInputInput, context?: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    private errorResult;
}
export {};
