/**
 * SpaceEngine 上传（View API）公共类型。
 *
 * 抽自 `artifact-tool.ts` 的「申请凭证 → 直传对象存储 → 提交导入 → 轮询结果」链路，
 * 供 Artifact 与资料库上传（LibraryUpload）等调用方共用；接口本身与业务语义解耦，
 * 公开分享、覆盖既有节点等行为由调用方通过请求字段决定。
 */
/** 上传源：一次上传的文件内容。 */
export interface UploadBody {
    /** 内容总字节数，用于 `Content-Length`。 */
    size: number;
    /**
     * 返回一个**从 0 开始的新流**。重试（如 PUT 失败后重发）会再次调用，
     * 因此实现必须能从同一份底层数据重建完整输入。
     */
    openStream(): NodeJS.ReadableStream;
}
/** 轮询配置；缺省 `{ intervalMs: 2000, maxRetries: 30 }`（与 Artifact 既有行为一致）。 */
export interface SpaceUploadPollOptions {
    intervalMs?: number;
    maxRetries?: number;
}
/** 一次上传请求。 */
export interface SpaceUploadRequest {
    source: UploadBody;
    fileName: string;
    /** PUT 到对象存储时的 `Content-Type`；缺省 `application/octet-stream`。 */
    contentType?: string;
    /** 目标父节点；不传由服务端决定默认落点。 */
    parentId?: string;
    /** 是否允许生成公开分享链接。不传则请求体不带该字段（由调用方语义决定）。 */
    supportShare?: boolean;
    /** 覆盖既有节点（Artifact 原地更新用）；不传表示新建。 */
    nodeBlockId?: string;
    poll?: SpaceUploadPollOptions;
}
/** 上传成功结果。 */
export interface SpaceUploadResult {
    taskId: string;
    nodeId: string;
    nodeKind: string;
    url?: string;
    publishUrl?: string;
}
/** 失败发生的阶段，供调用方把失败映射成自己的错误码体系。 */
export type SpaceUploadStage = 'credential' | 'upload' | 'import' | 'poll';
/** 上传失败：诊断文案 + 可选的后端业务错误码 + 阶段。 */
export interface SpaceUploadFailure {
    /** 人类可读诊断文案，拼进调用方的失败提示。 */
    detail?: string;
    /** 后端返回的业务错误码（如 56040 / 619610 / 20010），由调用方决定怎么展示。 */
    errorCode?: number;
    stage?: SpaceUploadStage;
    /**
     * 导入已受理、但客户端没等到终态时的任务 ID。任务在服务端仍可能继续执行，
     * 调用方应据此提示用户稍后核对，而不是当成本次上传已失败直接重传。
     */
    taskId?: string;
    /** 需要单独识别的失败原因：状态未知（轮询超时 / 进度查询失败），其余情况不设置。 */
    reason?: 'poll-timeout' | 'poll-status-unknown';
}
/** 上传结果：成功返回结果，失败返回 `{ failure }`（判别靠 `'failure' in outcome`）。 */
export type SpaceUploadOutcome = SpaceUploadResult | {
    failure: SpaceUploadFailure;
};
