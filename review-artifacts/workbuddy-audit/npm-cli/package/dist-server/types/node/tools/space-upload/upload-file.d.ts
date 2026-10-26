import type { SpaceUploadOutcome, SpaceUploadRequest } from './types';
/**
 * SpaceEngine 上传链路（抽自 `ArtifactTool.uploadToKnowledge`，行为与文案保持不变）：
 *   1. POST /space/api/view/import/uploadCredential → 预签名 URL + cosKey/confirmKey + STS 头
 *   2. PUT 到对象存储（body 取自 `UploadBody.openStream()`，带 Content-Length）
 *   3. POST /space/api/view/import/importLocalFileAsync → taskId
 *   4. 轮询 /space/api/view/import/queryImportFileProgress → 终态结果
 *
 * 调用方负责业务语义：`supportShare` / `nodeBlockId` 由请求字段决定，
 * 公开权限补设、分享链接拼装等留在各工具内部。
 */
/** 日志出口：只用到 error 与可选 warn，便于单测注入 fake。 */
export interface SpaceUploadLogger {
    error(message: string): void;
    warn?(message: string): void;
}
/** 上传依赖：endpoint 与鉴权头由调用方提供（CLI 工具自带登录态与 logger）。 */
export interface SpaceUploadDeps {
    /** 产品 endpoint（尾部斜杠已去掉）。 */
    endpoint: string;
    /** 鉴权头，必须含 `Authorization`。 */
    headers: Record<string, string>;
    /** 日志标签，保持各调用方原有日志文本（如 `Artifact`）。 */
    logTag: string;
    logger?: SpaceUploadLogger;
}
export declare function uploadToSpace(request: SpaceUploadRequest, deps: SpaceUploadDeps): Promise<SpaceUploadOutcome>;
