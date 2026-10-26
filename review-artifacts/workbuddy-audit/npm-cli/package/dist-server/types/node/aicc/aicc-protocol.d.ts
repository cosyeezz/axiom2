/**
 * AICC 机密模型（glm-5.2-aicc）客户端接入的契约层。
 *
 * 落点（详见 docs/superpowers/specs/2026-09-29-aicc-confidential-model-design.md）：
 * - 加密：ModelRequestProcessor 优先级 9998（Sensitive 9990、ToolRiskReview 9995 之后，gzip 9999 之前）；
 * - 取密钥与解密：Model 包装层 AiccModelBoundary，两者经 AsyncLocalStorage 关联；
 * - 控制面（DescribeEndpoints / 握手）：SDK setTransport → RestOperations POST /v1/aicc；
 * - 位置校验：SDK 兼容模式（Mode.COMPATIBLE），信封位置 / 协议不符只记 info 日志（SDK 进程级 logger 桥到 telemetry）、
 *   照常解密，以适配 modelhub 的改写；兼容模式下新网关的流式回文没有尾片（SDK 1.4.0 / 网关 2026-10-11），
 *   流以协议终止帧 + EOF 收束、只有逐片完整性，尾片校验只在 STRICT 生效；
 * - 其余一律 fail-closed，不回退明文。
 */
export declare const AiccChannelService: unique symbol;
export declare const AiccModelBoundary: unique symbol;
/** 默认走 AICC 端到端加密的内置模型 id；可被 productFeaturesConfig.AiccConfidentialModel.models 覆盖。 */
export declare const AICC_DEFAULT_MODEL_IDS: readonly string[];
/**
 * 模型目录里声明"这是 AICC 机密模型"的标签 `enterprise:aicc`，拆成命名空间与取值两段
 * （LanguageModel.labels 的每一项形如 `<namespace>:<value>`）。
 * labels 是多方共用的字段：AICC 只读 `enterprise` 命名空间，其他命名空间的项一律忽略；
 * 同命名空间的其他取值（如 `enterprise:selfhost`）与 AICC 判定无关。
 */
export declare const AICC_MODEL_LABEL_NAMESPACE = "enterprise";
export declare const AICC_MODEL_LABEL_VALUE = "aicc";
/** APISIX 上代理 AICC 控制面的相对路径；baseURL 由 ProductEndpointHttpInterceptor 补齐。 */
export declare const AICC_GATEWAY_PATH = "/v1/aicc";
export declare const AICC_MODE_HEADER = "X-AICC-Mode";
export declare const AICC_ENDPOINT_HEADER = "X-AICC-Endpoint";
/** ModelPool 按 model 绑定端点的有效期（秒）。 */
export declare const AICC_MODEL_POOL_TTL_SECONDS = 300;
/** 每个端点的 SessionPool 容量。 */
export declare const AICC_SESSION_POOL_SIZE = 2;
/** SDK 只用它做 URL 合法性校验并原样传给 transport；transport 忽略它，真实地址由 RestOperations 拦截器决定。 */
export declare const AICC_PLACEHOLDER_BASE_URL = "https://aicc.invalid/v1/aicc";
/**
 * 控制面单次 HTTP 调用超时（毫秒），与 SDK 每次尝试的超时一致：SDK 1.4.0 起在 transport 之外对每次尝试计 15 s，
 * 并对 CreateSecuritySession / DescribeEndpoints 的传输失败与 5xx 自行重试（共 3 次尝试）；
 * 对齐后 SDK 放弃一次尝试时底层请求同时中止，不会与重试并发挂着。
 */
export declare const AICC_TRANSPORT_TIMEOUT_MS = 15000;
/** 控制面响应体上限（字节），与 SDK 自身的 MAX_RESPONSE_BYTES（1 MiB）一致。 */
export declare const AICC_TRANSPORT_MAX_RESPONSE_BYTES: number;
/**
 * 在 SensitiveModelRequestProcessor（9990）、ToolRiskReviewModelRequestProcessor（9995）之后，
 * GzipRequestProcessor（9999）之前：所有改写 messages 的处理器都必须先于加密执行。
 */
export declare const AICC_REQUEST_PROCESSOR_PRIORITY = 9998;
/** 企业旗舰版账号类型（@genie/authentication `Edition.Ultimate` 的字面值，按 account-utils 口径小写比较）。 */
export declare const AICC_ENTERPRISE_ACCOUNT_TYPES: readonly string[];
/** productFeaturesConfig.AiccConfidentialModel 的形状。 */
export interface AiccConfidentialModelProductConfig {
    models?: string[];
}
/**
 * 一次模型调用的 AICC 计划：modelId 为精确命中名单、且在模型目录里带 `enterprise:aicc` 标签的原始模型 id；
 * custom-local: 自定义模型不会产生计划。
 */
export interface AiccCallPlan {
    modelId: string;
    aiccModel: string;
    flags: string[] | null;
}
/**
 * 解密统计：对策略路径上每个非空字符串叶子，解密前后值变化记 protectedLeaves，
 * 未变化记 plaintextLeaves（调用方据此 fail-closed）。
 */
export interface AiccDecryptStats {
    protectedLeaves: number;
    plaintextLeaves: number;
}
export interface AiccStreamDecryptorHandle {
    /**
     * 本流是否应以合法尾片收束：只有 STRICT 流有尾片；COMPATIBLE（生产模式）对新网关恒 false，
     * 流以协议终止帧 + EOF 收束，调用方不得把 finished=false 当成截断。
     */
    readonly finalChunkExpected: boolean;
    /** 已收到合法尾片（兼容模式对新网关恒 false；对旧网关的合成尾片仍会翻 true）。 */
    readonly finished: boolean;
    /** event 为 null 表示网关合成的空尾片，调用方不得转发。 */
    decryptEvent(eventJson: string): AiccDecryptStats & {
        event: string | null;
        finished: boolean;
    };
}
/** 一次 HTTP 逻辑请求的加解密句柄（包装 SDK Request）。 */
export interface AiccRequestHandle {
    readonly requestId: string;
    /** 握手时实际使用的不透明集群端点（X-AICC-Endpoint 值）；未设为空串。 */
    readonly endpoint: string;
    /** protected=false 表示零命中（SDK 原样返回），调用方必须 fail-closed。 */
    encryptRequestBody(bodyJson: string): {
        body: string;
        protected: boolean;
    };
    decryptResponseBody(bodyJson: string): AiccDecryptStats & {
        body: string;
    };
    newStreamDecryptor(): AiccStreamDecryptorHandle;
    /** 擦除本请求的数据密钥，幂等。 */
    close(): void;
}
export interface AiccChannelService {
    /** gate 判定：未命中返回 undefined。 */
    resolve(modelId: string): Promise<AiccCallPlan | undefined>;
    /** 取本轮请求句柄（首次触发端点发现与握手）。 */
    openRequest(plan: AiccCallPlan): Promise<AiccRequestHandle>;
    close(): void;
}
export interface AiccModelBoundary {
    wrapModel<T>(model: T, modelId: string): T;
}
export type AiccErrorCode = 'AICC_DISCOVERY_FAILED' | 'AICC_HANDSHAKE_FAILED' | 'AICC_REQUEST_ENCRYPT_FAILED' | 'AICC_REQUEST_NOT_PROTECTED' | 'AICC_RESPONSE_DECRYPT_FAILED' | 'AICC_RESPONSE_PLAINTEXT' | 'AICC_STREAM_TRUNCATED' | 'AICC_STREAM_DESYNC';
/** AICC 链路的本地永久失败：不重试、不回退明文。message 只含错误码与脱敏说明。 */
export declare class AiccError extends Error {
    readonly code: AiccErrorCode;
    readonly retryable = false;
    constructor(code: AiccErrorCode, message: string, options?: {
        cause?: unknown;
    });
}
export declare function isAiccError(error: unknown): error is AiccError;
