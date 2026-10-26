/**
 * 本地文件读取（LibraryUpload 的文件访问校验）。
 *
 * 顺序是硬约束，缺一不可：
 *   1. 字符串路径 → `resolveFilePathToWorkDir` 归一化（只接受绝对路径与 file:// URI）；
 *   2. `realpath` 解析软链；
 *   3. `stat` 记录 dev/ino，open 后与 `fstat` 比对，把校验过的路径和真正打开的 fd 绑定（防 TOCTOU 替换）；
 *   4. 基于 `fstat` 判断，只允许普通非空文件。
 *
 * 不限制路径落在工作区内：用户主动把任意本地文件交给 agent 上传是正常诉求
 * （附件常在 Documents / 桌面）。敏感路径由平台侧的 denyRead 规则与工具权限拦截，
 * 这里只负责「打开的是一个没被换掉的普通文件」。
 */
/** 打开本地文件失败的原因，由调用方映射成工具契约错误码。 */
export type LocalFileFailureCode = 'INVALID_ARGUMENT' | 'PATH_NOT_ALLOWED' | 'FILE_NOT_FOUND' | 'NOT_REGULAR_FILE' | 'EMPTY_FILE';
export interface LocalFileFailure {
    code: LocalFileFailureCode;
    detail?: string;
}
export interface LocalFileSource {
    /** realpath 之后的绝对路径。 */
    realPath: string;
    /** 上传用的文件名（basename；调用方如需改名应在传入前校验扩展名一致）。 */
    fileName: string;
    size: number;
    /** 每次调用返回从 0 开始的**新**流；PUT 重试依赖该语义。 */
    openStream(): NodeJS.ReadableStream;
    /** 关闭底层 fd（幂等）。 */
    close(): Promise<void>;
}
export declare function openLocalFileSource(rawPath: string): Promise<LocalFileSource | {
    failure: LocalFileFailure;
}>;
