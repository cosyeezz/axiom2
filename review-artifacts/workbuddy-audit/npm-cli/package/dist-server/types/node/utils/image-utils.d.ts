interface CompressImageOptions {
    /** 内部调用需要感知 Jimp 解码失败时设为 true；公开默认仍保持失败回原图。 */
    throwOnFailure?: boolean;
}
export type PreparedImageDataUrl = {
    ok: true;
    dataUrl: string;
    mimeType: string;
} | {
    ok: false;
    reason: string;
};
/**
 * 图片工具类
 * 提供图片格式和MIME类型相关的工具方法
 */
export declare abstract class ImageUtils {
    static readonly IMAGE_TOO_LARGE_AFTER_COMPRESSION_PLACEHOLDER = "[Image too large \u2014 omitted after compression]";
    static readonly IMAGE_PROCESSING_ERROR_PLACEHOLDER = "[Image omitted because it could not be processed]";
    /**
     * 图片扩展名到MIME类型的映射表
     * 基于标准MIME类型规范
     */
    private static readonly IMAGE_MIME_TYPE_MAP;
    /**
     * 根据文件魔数字节检测 MIME 类型。
     *
     * 调用方需要区分"真实图片"与"扩展名/声明伪装"时（例如把本地字节外发给识图模型前）
     * 必须以此为准，不能回退扩展名。
     *
     * @param buffer 文件开头的字节缓冲区（不同格式所需字节数不同，WebP 最多需要 12 字节）
     * @returns 检测到的 MIME 类型，如果无法识别则返回 undefined
     */
    static detectMimeFromMagicBytes(buffer: Buffer): string | undefined;
    /**
     * 从 base64 字符串或 data URL 推断图片 MIME 类型。
     *
     * 主要用于 MCP 工具返回的图片：OpenAI Agents SDK 在归一化结构化工具输出时只读取
     * `mediaType`（而 MCP 用的字段是 `mimeType`），因此会丢弃 MIME 信息，且 base64 不带
     * `data:` 前缀——到达请求层时往往只剩裸 base64。优先解析 data URL 中声明的类型，
     * 否则解码开头字节做魔数检测，无法识别时回退调用方给出的类型（默认 `image/png`）。
     *
     * @param base64OrDataUrl 裸 base64 字符串，或形如 `data:image/png;base64,xxx` 的 data URL
     * @param fallbackMimeType 魔数无法识别时使用的 MIME 类型
     * @returns MIME 类型字符串，如 'image/png'、'image/jpeg'
     */
    static detectMimeFromBase64(base64OrDataUrl: string, fallbackMimeType?: string): string;
    /**
     * 为模型请求准备图片 data URL。
     *
     * 对齐 Codex 的 image preparation 边界：不信任上游 MIME，而是严格解码 base64，
     * 用实际图片解码器验证内容，并用解码出的格式重新生成 data URL。这样既能修正
     * JPEG-as-PNG 一类声明错误，也能在模型请求前隔离无效 base64、伪图片或截断图片。
     *
     * JPEG/PNG/WebP 保留原始字节；其它可解码格式转为 PNG，不支持的格式返回失败。
     */
    static prepareImageDataUrl(base64OrDataUrl: string, fallbackMimeType?: string): Promise<PreparedImageDataUrl>;
    /**
     * 根据图片文件路径或扩展名获取对应的 MIME 类型
     * 仅基于扩展名做同步判断；如需读取文件内容并做魔数检测，请调用异步版本
     * @param filePathOrExt 文件路径或扩展名(带.或不带.均可)
     * @returns MIME 类型字符串,如 'image/png', 'image/jpeg' 等
     *          如果无法识别扩展名,返回 'image/png' 作为默认值
     */
    static getImageMimeType(filePathOrExt: string): string;
    /**
     * 同步版本：根据文件内容魔数检测 MIME 类型
     * 仅在扩展名无法识别时调用此方法
     * @param buffer 文件内容缓冲区
     * @returns 检测到的 MIME 类型
     */
    private static detectMimeFromBufferSync;
    /**
     * 异步获取图片 MIME 类型，支持魔数检测
     * 总是读取文件内容进行魔数检测，确保即使文件名和内容不匹配也能正确识别
     * @param filePath 图片文件路径
     * @param readFileAsync 异步读文件函数（通常是 readFile from fs/promises）
     * @returns 正确的 MIME 类型字符串
     */
    static getImageMimeTypeAsync(filePath: string, readFileAsync: (path: string, options?: {
        flag?: string;
    }) => Promise<Buffer>): Promise<string>;
    /**
     * 同步版本：根据文件路径获取 MIME 类型（支持魔数检测）
     * 用于同步代码路径，不支持异步文件读取
     * @param filePathOrExt 文件路径或扩展名
     * @param readFileSync 同步读文件函数，用于未识别扩展名时的检测
     * @returns 正确的 MIME 类型字符串
     */
    static getImageMimeTypeSync(filePathOrExt: string, readFileSync?: (path: string) => Buffer): string;
    /**
     * 检查给定的扩展名是否为支持的图片格式
     * @param filePathOrExt 文件路径或扩展名
     * @returns 是否为支持的图片格式
     */
    static isSupportedImageFormat(filePathOrExt: string): boolean;
    /**
     * ViewImage 入口接受的图片扩展名。Read 按这份列表把图片统一引导到 ViewImage，
     * 不按模型能力判断；BMP/GIF 会在发给模型前转成 PNG。
     */
    static readonly VIEW_IMAGE_SUPPORTED_EXTENSIONS: readonly string[];
    /**
     * 检查给定的文件路径或扩展名是否为 ViewImage 支持的图片格式
     * @param filePathOrExt 文件路径或扩展名
     * @returns 是否支持
     */
    static isViewImageSupportedFormat(filePathOrExt: string): boolean;
    /**
     * 不同模型支持的图片格式配置
     * 基于各模型官方文档的实际支持情况
     */
    private static readonly MODEL_SUPPORTED_FORMATS;
    /**
     * 根据模型 ID 获取支持的图片格式列表
     * @param modelId 模型 ID (如 'gpt-5', 'claude-sonnet', 'gemini-3.1-pro')
     * @returns 支持的图片扩展名数组
     */
    static getSupportedImageFormats(modelId?: string): string[];
    /**
     * 检查指定模型是否支持某个图片格式
     * @param filePathOrExt 文件路径或扩展名
     * @param modelId 模型 ID (可选,不传则使用默认支持列表)
     * @returns 是否支持该图片格式
     */
    static isImageSupportedByModel(filePathOrExt: string, modelId?: string): boolean;
    private static logCompressionWarning;
    static getImageCompressionMaxDimension(): number;
    /** 返回所有合法的压缩档位值，用于文档/校验/CLI 展示 */
    static getSupportedCompressionDimensions(): readonly number[];
    private static getCurrentImageCompressionProfile;
    private static getBase64FromDataUrl;
    private static getRawBytesFromBase64;
    private static isWithinProfileSizeLimit;
    /** 与 isWithinProfileSizeLimit 同口径，但直接按字节判定，不为了比大小而造 base64 副本。 */
    private static isBufferWithinProfileSizeLimit;
    private static isJimpResolutionLimitError;
    /** 判断压缩链路失败后是否必须省略，避免把超尺寸或超体积原图继续塞进模型请求。 */
    private static shouldOmitAfterCompressionFailure;
    private static recompressImage;
    private static compressToProfileLimit;
    /**
     * 长边压缩图片
     * @param dataUrl 图片 data URL (data:image/xxx;base64,...)
     * @param maxLength 长边最大尺寸，默认 1080px
     * @returns 压缩后的 data URL；如果不需要压缩或压缩失败则返回原图
     */
    static compressImage(dataUrl: string, maxLength?: number, options?: CompressImageOptions): Promise<string>;
    /**
     * 将图片转换为 JPEG 格式
     * @param dataUrl 图片 data URL
     * @param quality JPEG 质量 (1-100)，默认 85
     * @returns JPEG 格式的 data URL
     */
    static convertToJpeg(dataUrl: string, quality?: number): Promise<string>;
    /**
     * 压缩用户消息中的图片
     * 处理流程：
     * 1. maxDimension=0 时直接透传
     * 2. 命中 profile 后，若原图已满足尺寸和大小上限则直接透传
     * 3. 仅尺寸超限时，先按目标长边缩放；Jimp 解码因分辨率保护失败时直接省略
     * 4. 若仍超大小上限，按 JPEG 质量阶梯逐级压缩
     * 5. 仍超限则丢弃
     *
     * @param dataUrl 图片 data URL (data:image/xxx;base64,...)
     * @param maxDimension 可选的压缩长边档位；不传时从环境变量读取
     * @returns 压缩后的 data URL，如果图片过大无法压缩则返回空串
     */
    static compressUserImage(dataUrl: string, maxDimension?: number): Promise<string>;
    /**
     * 计算重编码的目标长边。
     *
     * 两个后端共用：先满足 `profile.maxDimension`；若原图体积本身已超大小上限，说明它
     * **必然**要被重编码，此时按面积比再收一档，让编码在缩小后的图上做。
     *
     * 留 15% 安全边际：面积比只是「体积∝像素数」的估算，重编码器压缩率与原文件不完全
     * 一致（例如原图 deflate level 与编码器默认不同），不留余量时结果常常只差几个百分点
     * 就超限，于是被迫再补一次全尺寸编码——纯 JS 后端下那一次编码就是单张 old space
     * 开销的主要来源（实测 2000x1747 单次 q80 编码在 V8 堆分配约 142MB）。
     */
    private static resolveTargetDimension;
    /**
     * buffer 原生的用户图片压缩：限内透传 → 按字节预算预缩 → 必要时降质量 → 仍超限则丢弃。
     *
     * 全程不产生中间 base64 / data URL 副本、只解码一次，调用方只需对最终结果做一次 base64。
     * 对比 data URL 版：那边每一跳都要 `Buffer.from(base64)` + `Jimp.read` 重新解码、再
     * `toString('base64')` 拼回 data URL，单张 10MB 图走完 4 级质量阶梯会反复制造十余份
     * 原图量级的大对象（实测峰值增量约 600MB）。
     *
     * @returns 压缩后的 `{ buffer, mime }`；图片压不到大小上限内时返回 undefined
     */
    static compressUserImageBuffer(buffer: Buffer, maxDimension?: number): Promise<{
        buffer: Buffer;
        mime: string;
    } | undefined>;
    /** 实际的解码 / 缩放 / 编码实现。 */
    private static compressWithCodec;
}
export {};
