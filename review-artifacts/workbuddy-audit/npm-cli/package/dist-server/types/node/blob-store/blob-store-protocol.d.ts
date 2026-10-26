import type { AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
export declare const BlobStore: unique symbol;
export declare const ImageBlobService: unique symbol;
/** Blob 引用（替代 base64 内嵌在历史中） */
export interface ImageBlobRef {
    type: 'image_blob_ref';
    /** sha256 hash */
    blob_id: string;
    /** MIME type, e.g. 'image/png' */
    mime: string;
    /** 原始二进制字节数 */
    size: number;
    /** 来源路径或 'generated' */
    source?: string;
    /** 完整 blob 文件路径, e.g. ~/.codebuddy/blobs/ab/ab3f7c...png */
    blob_path: string;
    /** 用户上传时的原始文件名, e.g. 'test1.jpeg' */
    original_filename?: string;
}
/** Durable content identity used to resolve a blob without trusting its path. */
export type ImageBlobIdentity = Pick<ImageBlobRef, 'type' | 'blob_id' | 'mime' | 'size'>;
export declare function isImageBlobIdentity(value: unknown): value is ImageBlobIdentity;
/** BlobStore 底层存储接口 */
export interface BlobStore {
    /** 存储 base64 数据，返回 ImageBlobRef */
    store(base64Data: string, mime: string, source?: string, originalFilename?: string): Promise<ImageBlobRef>;
    /**
     * 存储二进制数据，返回 ImageBlobRef。
     * 调用方已持有 Buffer 时走这里，避免为了适配 base64 入参而多造一份
     * base64 字符串 + 一份解码回来的 Buffer（大图下这两份副本各约原图的 1.33x / 1x）。
     */
    storeBuffer(data: Buffer, mime: string, source?: string, originalFilename?: string): Promise<ImageBlobRef>;
    /** 根据 blobId 读取 base64 数据 */
    read(blobId: string, mime?: string, expectedSize?: number): Promise<string | undefined>;
    /** 检查 blob 是否存在 */
    exists(blobId: string, mime?: string): Promise<boolean>;
    /** 获取 blob 文件路径 */
    getBlobPath(blobId: string, mime?: string): string;
}
/** ImageBlobService 高层服务接口 */
export interface ImageBlobService {
    /**
     * 将 base64 data URI 存入 BlobStore，返回 ImageBlobRef
     * @param dataUri 完整的 data:mime;base64,... 字符串
     * @param source 来源路径
     * @param originalFilename 用户上传时的原始文件名
     */
    storeFromDataUri(dataUri: string, source?: string, originalFilename?: string): Promise<ImageBlobRef>;
    /**
     * 将图片文件存入 BlobStore，返回 ImageBlobRef
     * @param filePath 图片文件路径
     * @param contents 调用方已读到的文件内容；传入时复用它，避免二次读盘
     */
    storeFromFile(filePath: string, contents?: Buffer): Promise<ImageBlobRef>;
    /**
     * 从 BlobRef 还原完整的 data URI
     */
    rehydrate(ref: ImageBlobIdentity, options?: {
        original?: boolean;
    }): Promise<string | undefined>;
    /**
     * 生成文本占位符
     */
    createPlaceholder(ref: ImageBlobRef): string;
    /**
     * 判断对象是否为 ImageBlobRef
     */
    isImageBlobRef(obj: unknown): obj is ImageBlobRef;
    /** 为一次工具运行预留实际读入的图片字节；owner 为该次 SDK RunContext。 */
    tryReserveImageBytes(bytes: number, owner: object): boolean;
    /** 该次运行的预算上限（0 表示不限量），首次访问时读取环境配置。 */
    getImageBudgetLimit(owner: object): number;
    /**
     * 对历史消息数组做 rehydration / 占位符替换
     * @param history 历史消息数组
     * @param retainRounds 保留最近 N 轮图片的完整 base64（默认 2）
     * @returns 处理后的历史数组（浅拷贝，不修改原始数据）
     */
    processHistoryForApi(history: AgentInputItem[], retainRounds: number): Promise<AgentInputItem[]>;
}
