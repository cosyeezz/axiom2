import { Session } from '../../vendor/cbc-core/node/index.js';
import { Agent, ToolArg, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { ImageService, Tool, ToolResult, VideoService } from './tool-protocol';
/** 视频模型的具体枚举和数量限制由远端 videoGeneration 配置决定。 */
declare const VideoGenParameters: z.ZodObject<{
    prompt: z.ZodOptional<z.ZodString>;
    image: z.ZodOptional<z.ZodString>;
    last_image: z.ZodOptional<z.ZodString>;
    reference_images: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    reference_videos: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    reference_audios: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    resolution: z.ZodOptional<z.ZodString>;
    seconds: z.ZodOptional<z.ZodNumber>;
    aspect_ratio: z.ZodOptional<z.ZodString>;
    enable_audio: z.ZodOptional<z.ZodBoolean>;
    output_dir: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    image?: string | undefined;
    prompt?: string | undefined;
    output_dir?: string | undefined;
    resolution?: string | undefined;
    last_image?: string | undefined;
    reference_images?: string[] | undefined;
    reference_videos?: string[] | undefined;
    reference_audios?: string[] | undefined;
    seconds?: number | undefined;
    aspect_ratio?: string | undefined;
    enable_audio?: boolean | undefined;
}, {
    image?: string | undefined;
    prompt?: string | undefined;
    output_dir?: string | undefined;
    resolution?: string | undefined;
    last_image?: string | undefined;
    reference_images?: string[] | undefined;
    reference_videos?: string[] | undefined;
    reference_audios?: string[] | undefined;
    seconds?: number | undefined;
    aspect_ratio?: string | undefined;
    enable_audio?: boolean | undefined;
}>;
export declare class VideoGenTool extends BaseTool implements Tool {
    protected readonly videoService: VideoService;
    protected readonly imageService: ImageService;
    protected readonly productManager: ProductManager;
    protected readonly logger: Logger;
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{
        prompt: z.ZodOptional<z.ZodString>;
        image: z.ZodOptional<z.ZodString>;
        last_image: z.ZodOptional<z.ZodString>;
        reference_images: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        reference_videos: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        reference_audios: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        resolution: z.ZodOptional<z.ZodString>;
        seconds: z.ZodOptional<z.ZodNumber>;
        aspect_ratio: z.ZodOptional<z.ZodString>;
        enable_audio: z.ZodOptional<z.ZodBoolean>;
        output_dir: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        image?: string | undefined;
        prompt?: string | undefined;
        output_dir?: string | undefined;
        resolution?: string | undefined;
        last_image?: string | undefined;
        reference_images?: string[] | undefined;
        reference_videos?: string[] | undefined;
        reference_audios?: string[] | undefined;
        seconds?: number | undefined;
        aspect_ratio?: string | undefined;
        enable_audio?: boolean | undefined;
    }, {
        image?: string | undefined;
        prompt?: string | undefined;
        output_dir?: string | undefined;
        resolution?: string | undefined;
        last_image?: string | undefined;
        reference_images?: string[] | undefined;
        reference_videos?: string[] | undefined;
        reference_audios?: string[] | undefined;
        seconds?: number | undefined;
        aspect_ratio?: string | undefined;
        enable_audio?: boolean | undefined;
    }>;
    resolveNeedPermissionArgs(_runContext: RunContext<Session>, input: z.infer<typeof VideoGenParameters>): ToolArg[];
    isEnabled: (_args: {
        runContext: RunContext<Session>;
        agent: Agent;
    }) => Promise<boolean>;
    execute(input: z.infer<typeof VideoGenParameters>, context: RunContext<Session>): Promise<ToolResult>;
    private processImages;
    private processMedia;
    private processMediaInput;
    private isLocalFileInput;
    private getMediaMimeType;
}
export {};
