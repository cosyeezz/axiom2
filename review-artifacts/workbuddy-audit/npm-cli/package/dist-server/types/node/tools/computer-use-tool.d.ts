import { Session } from '../../vendor/cbc-core/node/index.js';
import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { Tool, ToolResult } from './tool-protocol';
declare const ComputerUseParameters: z.ZodObject<{
    action: z.ZodEnum<["screenshot", "left_click", "right_click", "middle_click", "double_click", "triple_click", "mouse_move", "left_click_drag", "type", "key", "hold_key", "scroll", "wait", "cursor_position"]>;
    coordinate: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
    start_coordinate: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
    text: z.ZodOptional<z.ZodString>;
    scroll_direction: z.ZodOptional<z.ZodEnum<["up", "down", "left", "right"]>>;
    scroll_amount: z.ZodOptional<z.ZodNumber>;
    duration: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    action: "key" | "type" | "scroll" | "screenshot" | "double_click" | "wait" | "left_click" | "right_click" | "middle_click" | "triple_click" | "mouse_move" | "left_click_drag" | "hold_key" | "cursor_position";
    text?: string | undefined;
    duration?: number | undefined;
    scroll_direction?: "left" | "right" | "down" | "up" | undefined;
    scroll_amount?: number | undefined;
    coordinate?: number[] | undefined;
    start_coordinate?: number[] | undefined;
}, {
    action: "key" | "type" | "scroll" | "screenshot" | "double_click" | "wait" | "left_click" | "right_click" | "middle_click" | "triple_click" | "mouse_move" | "left_click_drag" | "hold_key" | "cursor_position";
    text?: string | undefined;
    duration?: number | undefined;
    scroll_direction?: "left" | "right" | "down" | "up" | undefined;
    scroll_amount?: number | undefined;
    coordinate?: number[] | undefined;
    start_coordinate?: number[] | undefined;
}>;
type ComputerUseInput = z.infer<typeof ComputerUseParameters>;
export declare class ComputerUseTool extends BaseTool implements Tool {
    protected readonly logger: Logger;
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{
        action: z.ZodEnum<["screenshot", "left_click", "right_click", "middle_click", "double_click", "triple_click", "mouse_move", "left_click_drag", "type", "key", "hold_key", "scroll", "wait", "cursor_position"]>;
        coordinate: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
        start_coordinate: z.ZodOptional<z.ZodArray<z.ZodNumber, "many">>;
        text: z.ZodOptional<z.ZodString>;
        scroll_direction: z.ZodOptional<z.ZodEnum<["up", "down", "left", "right"]>>;
        scroll_amount: z.ZodOptional<z.ZodNumber>;
        duration: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        action: "key" | "type" | "scroll" | "screenshot" | "double_click" | "wait" | "left_click" | "right_click" | "middle_click" | "triple_click" | "mouse_move" | "left_click_drag" | "hold_key" | "cursor_position";
        text?: string | undefined;
        duration?: number | undefined;
        scroll_direction?: "left" | "right" | "down" | "up" | undefined;
        scroll_amount?: number | undefined;
        coordinate?: number[] | undefined;
        start_coordinate?: number[] | undefined;
    }, {
        action: "key" | "type" | "scroll" | "screenshot" | "double_click" | "wait" | "left_click" | "right_click" | "middle_click" | "triple_click" | "mouse_move" | "left_click_drag" | "hold_key" | "cursor_position";
        text?: string | undefined;
        duration?: number | undefined;
        scroll_direction?: "left" | "right" | "down" | "up" | undefined;
        scroll_amount?: number | undefined;
        coordinate?: number[] | undefined;
        start_coordinate?: number[] | undefined;
    }>;
    /**
     * 启用条件：必须 macOS 且 env CODEBUDDY_COMPUTER_USE_ENABLED=1/true。
     */
    private isComputerUseEnabled;
    isEnabled: (_args?: unknown) => Promise<boolean>;
    /**
     * 同步镜像 isEnabled 的 gate，用于 ToolSearch 延迟工具列表可见性过滤。
     * gate 未开时不应出现在 "Available deferred tools" 描述里，避免模型误判此工具可用。
     */
    shouldShowInToolSearch: () => boolean;
    execute(input: ComputerUseInput, _context?: RunContext<Session>): Promise<ToolResult>;
    /**
     * screenshot 返图：严格照抄 read-tool 形态——读 JPEG base64 → image_url data URI。
     */
    private formatScreenshot;
    private dispatch;
    /**
     * 非 screenshot action 返 JSON content（string 形态）+ text renderer。
     * rawResponse 保留原始 payload 供 PostToolUse hook 消费。
     */
    private formatResult;
    private describeAction;
}
export {};
