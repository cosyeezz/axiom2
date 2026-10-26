import { RestOperations } from '@celljs/http';
import { AuthenticationManager } from '@genie/authentication';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { LanguageModel, ProductConfiguration, ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { SettingsManager } from '../settings';
import { MediaFileWriter } from './media-file-writer';
import { EditImageParams, GenerateImageParams, ImageGenData, type ImageGenerationResult, ImageService } from './tool-protocol';
export declare class ImageServiceImpl implements ImageService {
    protected readonly restOperations: RestOperations;
    protected readonly authenticationManager: AuthenticationManager;
    protected readonly productManager: ProductManager;
    protected readonly logger: Logger;
    protected readonly settingsManager: SettingsManager;
    protected readonly mediaFileWriter: MediaFileWriter;
    private outputDir;
    /**
     * 初始化输出目录
     */
    initializeOutputDir(customOutputDir?: string): Promise<void>;
    /**
     * 文生图 API 调用
     */
    generateImage(params: GenerateImageParams, context: RunContext<Session>): Promise<ImageGenerationResult>;
    /**
     * 图生图 API 调用
     */
    editImage(params: EditImageParams, context: RunContext<Session>): Promise<ImageGenerationResult>;
    /**
     * 处理图片输入，转换为 base64 格式
     * 支持多种输入格式：
     * 1. 文件路径: "/path/to/image.png"
     * 2. Data URL: "data:image/png;base64,iVBOR..."
     * 3. 纯 base64 字符串
     * 4. HTTP/HTTPS URL: "https://example.com/image.png"
     *
     * @param imageInput 图片输入（文件路径、base64、data URL 或 HTTP URL）
     * @returns base64 编码的图片数据，格式: "image/jpeg;base64,..."
     */
    processImageInput(imageInput: string, signal?: AbortSignal, session?: Session): Promise<string>;
    /**
     * 检查字符串是否可能是 base64 编码
     * - 不包含路径分隔符
     * - 只包含 base64 字符集 (A-Z, a-z, 0-9, +, /, =)
     * - 长度足够长（至少 100 字符，避免误判短文件名）
     */
    private isLikelyBase64;
    /**
     * 处理 Data URL 格式的输入
     */
    private processDataUrl;
    /**
     * 处理纯 base64 字符串
     * 尝试检测图片类型，如果无法检测则默认使用 image/png
     */
    private processRawBase64;
    /**
     * 处理 HTTP/HTTPS URL
     */
    private processHttpUrl;
    private downloadPublicImage;
    private parsePublicImageUrl;
    private readImageResponse;
    /**
     * 处理本地文件路径
     */
    private processFilePath;
    /**
     * 从 base64 内容检测图片 MIME 类型
     * 通过检查文件头魔数（magic bytes）来判断
     */
    private detectMimeTypeFromBase64;
    /**
     * 根据文件扩展名获取 MIME 类型
     */
    private getMimeType;
    /**
     * 保存图片到本地
     */
    saveImage(imageData: ImageGenData, prompt: string, index: number, signal?: AbortSignal): Promise<string>;
    /**
     * 从错误中提取错误信息
     */
    extractErrorMessage(error: unknown): string;
    /**
     * 获取指定 tag 的模型列表
     */
    getModelsByTag(product: ProductConfiguration, tag: string): LanguageModel[];
    /**
     * 准备请求所需的认证和配置信息
     */
    private prepareRequest;
    /**
     * 构建基础请求体
     *
     * 按模型分发可选字段，避免给后端发送目标模型不支持的字段
     * （Hunyuan / Gemini 模型不接受 OpenAI-only 字段，发送会触发后端校验失败，
     * 例如 hunyuan-image-v3.0-art 会返回 14401 "exceeds the maximum supported limit (0)"）：
     * - OpenAI 模型：支持 n / quality / background / response_format / style
     * - Hunyuan 模型：仅支持 footnote / revise
     * - Gemini 模型：仅基础字段（model / prompt / size / image）
     */
    private buildBaseRequestBody;
    /**
     * 处理 API 响应
     */
    private processResponse;
    /**
     * 解析模型
     * 优先级：session options > 环境变量 > 合并设置 > 配置中第一个对应 tag 的模型 > fallback
     */
    resolveModel(session: Session | undefined, tag: string): Promise<string>;
}
