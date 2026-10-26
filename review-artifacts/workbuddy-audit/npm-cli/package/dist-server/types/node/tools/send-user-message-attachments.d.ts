/**
 * SendUserMessage 工具解析后的附件元信息（issue #82025，对齐 claude-code）。
 *
 * `file_uuid` 预留给远程上传场景（BRIDGE_MODE 专属），本期只解析本地元信息、
 * 不做上传，因此始终为 undefined。上传与客户端消费按 issue 备注另行拆分。
 */
export interface ResolvedAttachment {
    path: string;
    size: number;
    isImage: boolean;
    file_uuid?: string;
}
/**
 * 校验附件路径：文件须存在且为常规文件。任一不满足抛出可读错误，
 * 让模型看到失败原因（cwd 一并带上，便于定位相对路径）。
 */
export declare function validateAttachmentPaths(rawPaths: string[]): Promise<void>;
/**
 * 解析附件路径为元信息 `{ path, size, isImage }`。串行 stat 保持顺序确定，
 * 与入参顺序一致。本期不做远程上传。
 */
export declare function resolveAttachments(rawPaths: string[]): Promise<ResolvedAttachment[]>;
