import { Session } from '../../vendor/cbc-core/node/index.js';
import { Agent, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { ImageService, Tool, ToolResult } from './tool-protocol';
export { TEXT_TO_IMAGE_MODEL_TAG } from './tool-protocol';
/**
 * 文生图 + 图生图参数 Schema
 * image1-3 为可选参数：传入则为图生图（支持 1-3 张参考图），不传则为文生图
 */
declare const ImageGenParameters: z.ZodObject<{
    prompt: z.ZodString;
    size: z.ZodOptional<z.ZodString>;
    quality: z.ZodOptional<z.ZodString>;
    style: z.ZodOptional<z.ZodString>;
    background: z.ZodOptional<z.ZodString>;
    footnote: z.ZodOptional<z.ZodString>;
    revise: z.ZodOptional<z.ZodBoolean>;
    output_dir: z.ZodOptional<z.ZodString>;
} & {
    image1: z.ZodOptional<z.ZodString>;
    image2: z.ZodOptional<z.ZodString>;
    image3: z.ZodOptional<z.ZodString>;
    input_fidelity: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    prompt: string;
    size?: string | undefined;
    background?: string | undefined;
    quality?: string | undefined;
    style?: string | undefined;
    footnote?: string | undefined;
    revise?: boolean | undefined;
    output_dir?: string | undefined;
    input_fidelity?: string | undefined;
    image1?: string | undefined;
    image2?: string | undefined;
    image3?: string | undefined;
}, {
    prompt: string;
    size?: string | undefined;
    background?: string | undefined;
    quality?: string | undefined;
    style?: string | undefined;
    footnote?: string | undefined;
    revise?: boolean | undefined;
    output_dir?: string | undefined;
    input_fidelity?: string | undefined;
    image1?: string | undefined;
    image2?: string | undefined;
    image3?: string | undefined;
}>;
export declare class ImageGenTool extends BaseTool implements Tool {
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
        image1: z.ZodOptional<z.ZodString>;
        image2: z.ZodOptional<z.ZodString>;
        image3: z.ZodOptional<z.ZodString>;
        input_fidelity: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        prompt: string;
        size?: string | undefined;
        background?: string | undefined;
        quality?: string | undefined;
        style?: string | undefined;
        footnote?: string | undefined;
        revise?: boolean | undefined;
        output_dir?: string | undefined;
        input_fidelity?: string | undefined;
        image1?: string | undefined;
        image2?: string | undefined;
        image3?: string | undefined;
    }, {
        prompt: string;
        size?: string | undefined;
        background?: string | undefined;
        quality?: string | undefined;
        style?: string | undefined;
        footnote?: string | undefined;
        revise?: boolean | undefined;
        output_dir?: string | undefined;
        input_fidelity?: string | undefined;
        image1?: string | undefined;
        image2?: string | undefined;
        image3?: string | undefined;
    }>;
    isEnabled: (_args: {
        runContext: RunContext<Session>;
        agent: Agent;
    }) => Promise<boolean>;
    execute(input: z.infer<typeof ImageGenParameters>, context: RunContext<Session>): Promise<ToolResult>;
}
