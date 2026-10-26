import { Logger } from '@celljs/core';
import { type BlobStore, type ImageBlobRef } from './blob-store-protocol';
export declare class BlobStoreImpl implements BlobStore {
    protected readonly logger: Logger;
    protected init(): void;
    store(base64Data: string, mime: string, source?: string, originalFilename?: string): Promise<ImageBlobRef>;
    storeBuffer(buffer: Buffer, mime: string, source?: string, originalFilename?: string): Promise<ImageBlobRef>;
    /**
     * blob 落盘失败是否可降级（跳过缓存而非崩 turn）。
     * 仅对「环境不可写」类文件系统 errno 降级：只读/served FS（EROFS）、
     * 分片目录缺失（ENOENT）、权限（EACCES/EPERM）、空间/配额（ENOSPC/EDQUOT）、
     * 底层 IO/目录形态（EIO/ENOTDIR/EISDIR/EBUSY）。
     * 明确**不**降级 Node 的 `ERR_*` 编程错误（如 ERR_INVALID_ARG_TYPE）——
     * 这些带 `code` 但不是 FS errno，属于调用面 bug，应继续抛出以暴露而非被缓存降级咽掉。
     */
    private static readonly DEGRADABLE_FS_ERRNOS;
    private isDegradableWriteError;
    read(blobId: string, mime?: string, expectedSize?: number): Promise<string | undefined>;
    exists(blobId: string, mime?: string): Promise<boolean>;
    protected pathExists(filePath: string): Promise<boolean>;
    getBlobPath(blobId: string, mime?: string): string;
}
