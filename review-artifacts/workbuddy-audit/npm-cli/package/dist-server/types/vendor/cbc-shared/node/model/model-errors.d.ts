import { CustomError } from '@celljs/core';
export declare const AUTHENTICATION_REQUIRED_MESSAGE = "Authentication required. Please use /login command to sign in to your account";
export declare const AUTHENTICATION_FAILED_MESSAGE = "Authentication failed. Please use /login command to sign in to your account";
/**
 * Custom error types for model service
 */
/**
 * 流式响应超时错误
 * 当模型流式响应过程中长时间无数据时触发
 */
export declare class StreamTimeoutError extends CustomError {
    readonly timeoutMs: number;
    readonly chunkCount: number;
    readonly totalBytes: number;
    readonly isFirstTokenTimeout: boolean;
    constructor(timeoutMs: number, chunkCount?: number, totalBytes?: number, isFirstTokenTimeout?: boolean);
}
/**
 * placeholder：空 200 / 心跳占位，拦截器最多切一次备站，会话层终态。
 * reasoning-only：已流出思考、finish_reason=error 且无可用输出（#63761 / #122115）。
 * no-token：finish_reason=error 或 length 到达时一个模型 token 都没有（连 reasoning 也没有）。
 *   length 只归入 no-token：带 reasoning 的 length 照常交给 SDK，不算空流。
 *
 * reasoning-only 与 no-token 按「上游瞬时失败」处理，会话层按 error 恢复预算重试——
 * 但仅限流没跑太久的那些：已经烧满上游硬时限的同样形态重跑必然再次跑满，由
 * `isRetryableEmptyStreamError` 按 {@link EmptyStreamError.elapsedMs} 收口（#132616）。
 * placeholder 必须与 no-token 分开——两者共用一个值时，放开 no-token 会连带
 * 推翻空 200 的终态判定。
 */
export type EmptyStreamKind = 'placeholder' | 'reasoning-only' | 'no-token';
/**
 * 空流错误的结构化 category，两条上报通道共用一个值。
 *
 * ACP 侧 `classifyErrorAsRequestError` 早就用它（前端按此映射业务码 3008「模型服务未返回消息」）；
 * stream-json 侧此前没有任何结构化维度，`errors_info` 整体缺席，sandbox-proxy 的
 * `BuildErrorMessageFromCLIErrors` 只能兜底成 `category=internal`，再由
 * `ClassifyInBandPromptError` 推出 `error_origin=cli`——把上游故障记成 CLI 内部错误。
 * 挂到错误对象的 `data` 上让两条通道读到同一个值，不再各说各话。
 */
export declare const EMPTY_STREAM_ERROR_CATEGORY = "empty_model_response";
/** 触发空流判定的上游 finish_reason；placeholder 没有 finish_reason，不使用该值。 */
export type EmptyStreamFinishReason = 'error' | 'length';
/**
 * 空流错误
 * 语义上仍然是"上游没有提供模型输出"，所以继承 StreamTimeoutError
 * 以便 `isStreamTimeoutError` / ACP 分类识别。
 *
 * 典型触发：某些 OpenAI 兼容网关在后端异常时没有透传错误码，而是发一帧全空
 * `{"delta":{"role":"assistant","content":"","tool_calls":[],"refusal":""},"finish_reason":""}`
 * 然后直接关闭连接——用户看到的现象是 cbc 当前轮"空响应"并被 ACP 分类为 refusal。
 *
 * message **必须**按 kind 分开写：三种 kind 共用一句「only placeholder chunks」会谎报失败形态。
 * 0924 沙箱实测的 reasoning-only 样本里上游发了 20397 帧 / 9.5 MB 真实 reasoning，
 * 与「只有占位帧」正相反；而下游报表、看板、排障全靠这个字符串归因，于是把上游
 * ~900s 时限问题记成了 CLI 内部错误（#132616）。
 */
export declare class EmptyStreamError extends StreamTimeoutError {
    readonly emptyStreamKind: EmptyStreamKind;
    /**
     * 流从打开到判定空流的时长。
     *
     * 用来区分「上游瞬时抖动（秒级空响应）」和「跑满上游硬时限（0924 实测 ~900s）」——
     * 后者重跑同一段 prompt 必然再次跑满，重试只是把静默时长翻倍，见
     * `isRetryableEmptyStreamError` 的时长闸门。
     */
    readonly elapsedMs: number;
    readonly data: Readonly<{
        category: "empty_model_response";
    }>;
    /** reasoning-only 时已流出的思考，由 {@link withStreamedReasoning} 挂上；`declare` 保证未挂时不产生自有属性。 */
    readonly streamedReasoning?: string;
    constructor(chunkCount: number, totalBytes: number, kind?: EmptyStreamKind, elapsedMs?: number, finishReason?: EmptyStreamFinishReason);
}
/**
 * 把 reasoning-only 空流里已流出的思考挂到错误上，供会话层带着它续写。
 *
 * 模型层拦下 error 帧时不把这次响应交给 SDK（#63761）：与 error 帧同一分片的思考从未转发，
 * 先转发的分片也会随流报错被清出队列，所以思考只能由模型层随错误交出。
 * 不可枚举：错误会被打进日志、序列化后经 ACP / stream-json 上报，思考正文不能随之外泄。
 */
export declare function withStreamedReasoning(error: EmptyStreamError, reasoning: string): EmptyStreamError;
/**
 * 认证缺失错误
 * 缺少有效的 API Key 时抛出
 */
export declare class AuthenticationRequiredError extends CustomError {
    constructor(message?: string);
}
/**
 * 认证失败错误
 * API Key 无效时抛出
 */
export declare class AuthenticationFailedError extends CustomError {
    constructor(message?: string);
}
/**
 * 模型配置错误
 * 模型名称缺失等配置问题时抛出
 */
export declare class ModelConfigError extends CustomError {
    constructor(message: string);
}
/**
 * 自定义模型缺少接入地址时的 message 模板。
 *
 * 与 `AUTHENTICATION_REQUIRED_MESSAGE` 同口径用英文：CBC 抛出的 message 面向日志、
 * CLI 终端与排障，用户可见的本地化文案由前端按错误码查 i18n（`errorCode.4100`）。
 * 详见 `docs/error-codes.md` 的「文案来源：后端下发优先，前端 i18n 兜底」。
 */
export declare const customModelMissingUrlMessage: (modelId: string) => string;
/**
 * 旧版自定义模型缺少 API Key 时的 message 模板，保留导出兼容已有调用方。
 * CLI 不再仅根据 models.json 的 apiKey 字段拦截请求：凭据还可来自运行身份、
 * 全局 settings.env 或进程环境变量，由正常鉴权链路读取和使用。
 */
export declare const customModelMissingApiKeyMessage: (modelId: string) => string;
/**
 * 本地拉起模型（`local: true`，GGUF + llama-server）缺少接入地址时的 message 模板。
 *
 * 与 {@link customModelMissingUrlMessage} 分开：本地模型的 url 由 Daemon 启动 llama-server
 * 时注入，用户无法在设置里手填，指引「去填 url」会把运行时问题说成配置问题。
 */
export declare const localModelMissingUrlMessage: (modelId: string) => string;
/** 自定义模型缺少接入地址的业务错误码，已登记在 `docs/error-codes.md` 的客户端本地错误段。 */
export declare const CUSTOM_MODEL_CONFIG_ERROR_CODE = 4100;
/** 与 `acp-agent.ts` classifyErrorAsRequestError 的 category 集合对齐，供前端按分类选文案。 */
export declare const CUSTOM_MODEL_CONFIG_ERROR_CATEGORY = "custom_model_config";
/**
 * 自定义模型配置错误
 *
 * CLI 在本地自定义模型无法解析接入地址时抛出，避免回落到产品默认网关后误报
 * 11102「当前模型不可用，请切换其他模型」。模型独立 apiKey 是可选凭据来源，
 * 不再因该字段缺失抛出本错误；旧版缺 key 的 4100 历史仍沿用同一错误结构。
 *
 * `data` 由 ACP 层的 `extractStructuredErrorData` 读取后透传到客户端（headless 的
 * `errors_info[]` 同样会带上），前端按 4100 查 i18n 给出本地化的合并文案（不区分具体缺
 * 哪个字段）。
 *
 * message 请用 {@link customModelMissingUrlMessage} / {@link localModelMissingUrlMessage}
 * 构造，保持与同族错误一致的英文口径。
 *
 * `modelId` 是本轮出错的模型身份（issue #136649）：4100 在模型调用前拦截，本轮不会有任何
 * 带 `requestModelId` 的响应行落盘，唯一落到 JSONL 的是 InterruptionService 的 skipRun 错误
 * 行，它只从本错误的 `data` 里取得到模型 id。缺了它，重启后客户端恢复出的「前往配置」提示卡
 * 拿不到 modelId，跳转会退化成打开模型设置列表，而不是该模型的编辑页。
 */
export declare class CustomModelConfigError extends CustomError {
    readonly data: Readonly<{
        code: number;
        category: string;
        modelId?: string;
    }>;
    constructor(message: string, modelId?: string);
}
//# sourceMappingURL=model-errors.d.ts.map