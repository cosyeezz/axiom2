import { Logger } from '@celljs/core';
import type { AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
import { type BlobStore, type ImageBlobIdentity, type ImageBlobRef, type ImageBlobService } from './blob-store-protocol';
/** 图片内容本身无法通过统一 preparation；与 Blob 磁盘 I/O 异常严格区分。 */
export declare class InvalidImageDataError extends Error {
    constructor(reason: string);
}
export declare class ImageBlobServiceImpl implements ImageBlobService {
    protected readonly blobStore: BlobStore;
    protected readonly logger: Logger;
    protected init(): void;
    storeFromDataUri(dataUri: string, source?: string, originalFilename?: string): Promise<ImageBlobRef>;
    storeFromFile(filePath: string, contents?: Buffer): Promise<ImageBlobRef>;
    rehydrate(ref: ImageBlobIdentity, options?: {
        original?: boolean;
    }): Promise<string | undefined>;
    createPlaceholder(ref: ImageBlobRef): string;
    isImageBlobRef(obj: unknown): obj is ImageBlobRef;
    /**
     * 单轮（一次 agent run）允许读入的图片原始字节总量默认上限。
     *
     * **为什么换了原生编解码器仍然需要它**（实测推翻过一次直觉）：原生后端把编解码搬到
     * Rust 原生内存，单次编码的 V8 堆增量确实降到 0，但真正决定「一轮能处理多少张」的是
     * **与后端无关的累积量**——每张图读入的原始 Buffer、压缩结果 base64、data URL、
     * tool result JSON，以及 SDK 对 turn input 的深拷贝。实测两个后端的 OOM 临界点完全
     * 相同（48 张 × 10MB：heap=1024 都崩、heap=2048 都过），所以配额不能因为换后端而取消。
     *
     * 定标：完全不限量时 `--max-old-space-size=1024`（生产默认 ~4GB 的 1/4）下
     * 24 张 × 10MB 刚好通过、48 张必崩。默认 128MB（约 12 张 10MB 图）距离 240MB
     * 临界点留 2x 余量，实测 heap=512 / heap=1024 下都稳定通过。常见截图 0.5~3MB，
     * 相当于一轮 40~250 张，正常用法完全无感。
     *
     * 配额按 SDK RunContext 隔离，下一次运行有独立预算；辅助调用和其它会话
     * 不会重置当前运行已扣减的字节数。
     */
    private static readonly DEFAULT_MAX_IMAGE_MB_PER_RUN;
    /**
     * 覆盖单轮图片字节预算，单位 MB。
     *
     * - 未设 / 空 → 默认 128MB
     * - `0` → 完全不限制（**自担风险**：单轮图片够多时仍会硬 OOM，与编解码后端无关）
     * - 其它正整数 → 按该 MB 数限制
     * - 非法值 → 回落默认并告警
     */
    private static readonly MAX_IMAGE_MB_PER_TURN_ENV;
    /** 每次工具运行的预算，由 ViewImage 预留；随运行对象回收。 */
    private readonly imageBudgets;
    private budgetFor;
    private resolveMaxImageBytesPerRun;
    tryReserveImageBytes(bytes: number, owner: object): boolean;
    getImageBudgetLimit(owner: object): number;
    /** 同一 source 路径的图片在最近 N 轮中最多保留的版本数 */
    private static readonly MAX_VERSIONS_PER_SOURCE;
    processHistoryForApi(history: AgentInputItem[], retainRounds: number): Promise<AgentInputItem[]>;
    /**
     * 构建需要 rehydrate 的 item 索引集合。
     *
     * 规则：
     * 1. 相同 blob_id 只保留最后一次出现
     * 2. 同一 source 路径的不同版本只保留最后 MAX_VERSIONS_PER_SOURCE 个
     * 3. 不同 source / 无 source 的图片互不干扰
     */
    private buildRehydrateSet;
    /**
     * 从 item 中提取所有 ImageBlobRef 的 { blob_id, source }
     */
    private collectBlobRefs;
    /**
     * 从 JSON 字符串中提取 blob_id 和 source
     */
    private extractBlobRefsFromString;
    /**
     * 检查 item 中是否包含 ImageBlobRef
     */
    private itemHasBlobRef;
    /**
     * 还原 item 中的 ImageBlobRef 为完整 data URI
     */
    private rehydrateItem;
    /**
     * 将 item 中的 ImageBlobRef 替换为文本占位符
     */
    private dehydrateItem;
    /**
     * 还原 FunctionCallResult 中的 ImageBlobRef
     */
    private rehydrateFunctionCallResult;
    /**
     * 将 FunctionCallResult 中的 ImageBlobRef 替换为占位符
     */
    private dehydrateFunctionCallResult;
    /**
     * 异步处理 content 数组中的 ImageBlobRef（rehydrate）
     */
    private processContentArray;
    /**
     * 同步处理 content 数组中的 ImageBlobRef（dehydrate -> 占位符）
     */
    private processContentArraySync;
    /**
     * 从 image_url.url 中提取 ImageBlobRef。
     * url 可能是：
     * - ImageBlobRef 对象（直接返回）
     * - JSON 字符串化的 ImageBlobRef（解析后返回）
     * - 正常的 data URI 或 http URL（返回 undefined）
     */
    private extractBlobRefFromUrl;
}
