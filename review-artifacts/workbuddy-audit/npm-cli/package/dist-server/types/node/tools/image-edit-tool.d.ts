import { Session } from '../../vendor/cbc-core/node/index.js';
import { Agent, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { ImageService, Tool, ToolResult } from './tool-protocol';
export { IMAGE_TO_IMAGE_MODEL_TAG } from './tool-protocol';
/**
 * 图生图参数 - 扩展基础参数 + 图生图特有参数
 */
declare const ImageEditParameters: z.ZodObject<{
    prompt: z.ZodString;
    size: z.ZodOptional<z.ZodString>;
    quality: z.ZodOptional<z.ZodString>;
    style: z.ZodOptional<z.ZodString>;
    background: z.ZodOptional<z.ZodString>;
    footnote: z.ZodOptional<z.ZodString>;
    revise: z.ZodOptional<z.ZodBoolean>;
    output_dir: z.ZodOptional<z.ZodString>;
} & {
    image: z.ZodString;
    input_fidelity: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    image: string;
    prompt: string;
    size?: string | undefined;
    background?: string | undefined;
    quality?: string | undefined;
    style?: string | undefined;
    footnote?: string | undefined;
    revise?: boolean | undefined;
    output_dir?: string | undefined;
    input_fidelity?: string | undefined;
}, {
    image: string;
    prompt: string;
    size?: string | undefined;
    background?: string | undefined;
    quality?: string | undefined;
    style?: string | undefined;
    footnote?: string | undefined;
    revise?: boolean | undefined;
    output_dir?: string | undefined;
    input_fidelity?: string | undefined;
}>;
export declare class ImageEditTool extends BaseTool implements Tool {
    protected readonly imageService: ImageService;
    protected readonly productManager: ProductManager;
    protected readonly logger: Logger;
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{
        prompt: z.ZodString;
        size: z.ZodOptional<z.ZodString>;
        quality: z.ZodOptional<z.ZodString>;
        style: z.ZodOptional<z.ZodString>;
        background: z.ZodOptional<z.ZodString>;
        footnote: z.ZodOptional<z.ZodString>;
        revise: z.ZodOptional<z.ZodBoolean>;
        output_dir: z.ZodOptional<z.ZodString>;
    } & {
        image: z.ZodString;
        input_fidelity: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        image: string;
        prompt: string;
        size?: string | undefined;
        background?: string | undefined;
        quality?: string | undefined;
        style?: string | undefined;
        footnote?: string | undefined;
        revise?: boolean | undefined;
        output_dir?: string | undefined;
        input_fidelity?: string | undefined;
    }, {
        image: string;
        prompt: string;
        size?: string | undefined;
        background?: string | undefined;
        quality?: string | undefined;
        style?: string | undefined;
        footnote?: string | undefined;
        revise?: boolean | undefined;
        output_dir?: string | undefined;
        input_fidelity?: string | undefined;
    }>;
    isEnabled: (_args: {
        runContext: RunContext<Session>;
        agent: Agent;
    }) => Promise<boolean>;
    execute(input: z.infer<typeof ImageEditParameters>, context: RunContext<Session>): Promise<ToolResult>;
}
