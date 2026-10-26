import { RestOperations } from '@celljs/http';
import { AuthenticationManager } from '@genie/authentication';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { LanguageModel, ProductConfiguration, ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { SettingsManager } from '../settings';
import { MediaFileWriter } from './media-file-writer';
import { type VideoGenerationPlan, type VideoGenerationResult, VideoGenParams, VideoService } from './tool-protocol';
/**
 * 视频服务实现
 * 封装文生视频的任务提交、轮询、下载逻辑
 */
export declare class VideoServiceImpl implements VideoService {
    protected readonly restOperations: RestOperations;
    protected readonly authenticationManager: AuthenticationManager;
    protected readonly productManager: ProductManager;
    protected readonly logger: Logger;
    protected readonly settingsManager: SettingsManager;
    protected readonly mediaFileWriter: MediaFileWriter;
    private outputDir;
    /**
     * 初始化视频输出目录
     */
    initializeOutputDir(customOutputDir?: string): Promise<void>;
    prepareGeneration(params: VideoGenParams, session: Session): Promise<VideoGenerationPlan>;
    private buildRequest;
    generateVideo(params: VideoGenParams, context: RunContext<Session>, prepared?: VideoGenerationPlan): Promise<VideoGenerationResult>;
    /**
     * 提交视频生成任务
     */
    private submitTask;
    private buildConfiguredRequest;
    private buildCompatibleRequest;
    private validateVideoParameters;
    private validateReferenceCount;
    /**
     * 轮询任务状态直到完成或失败
     */
    private pollTask;
    /**
     * 下载视频结果到本地
     */
    private downloadVideos;
    /**
     * 准备请求所需的认证和配置信息
     */
    private prepareRequest;
    /**
     * 可中断的 sleep
     */
    private sleep;
    /**
     * 获取指定 tag 的模型列表
     */
    getModelsByTag(product: ProductConfiguration, tag: string): LanguageModel[];
    private hasCompleteVideoGeneration;
    /**
     * 解析视频模型
     * 优先级：session options > 环境变量 > 合并设置 > defaultVideoModel > 首个能力配置完整的 tag 模型
     */
    resolveModel(session: Session | undefined, tag: string): Promise<string>;
    private resolveConfiguredModel;
}
