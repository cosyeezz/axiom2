import { RestOperations } from '@celljs/http';
import { AuthenticationManager } from '@genie/authentication';
import { AgentManager, DefaultInputItemProcessor, FunctionCallResultAgentInputItemProcessor, type ModelCallCompaction, ModelRequestRetryPhase, Session, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { Model } from '../../vendor/cbc-shared/node/index.js';
import { AbTestService, ClientInfoProvider, LanguageModel, ProductManager } from '@genie/product';
import { Logger, TraceService } from '@genie/telemetry';
import type { OpenAI } from 'openai';
import { type AiccModelBoundary as AiccModelBoundaryInterface } from '../aicc/aicc-protocol';
import { type ImageBlobService } from '../blob-store/blob-store-protocol';
import { GalileoTimingHook } from '../galileo';
import { GalileoService } from '../galileo/galileo-protocol';
import { type SecurityReviewGate as ISecurityReviewGate } from '../security-review/protocol';
import { type SensitiveModelBoundary as SensitiveModelBoundaryInterface } from '../sensitive-content';
import { SettingsManager } from '../settings/settings-protocol';
import { TelemetryService } from '../telemetry';
import { ModelErrorAnalyzer, ModelProvider, ModelRequestProcessor } from './model-protocol';
/**
 * 去掉模型把工具调用模板标签串进工具名的残片（如 `Bash</arg_value>`、`<tool_call>Read`）。
 * 合法工具名不含尖括号；清洗后为空时保留原值，交给既有「工具不存在」恢复链路。
 */
export declare function stripToolNameMarkup(name: string): string;
/**
 * 首 token 超时默认值：请求发出到第一个有意义的模型输出到达的最大等待时间。
 * 长上下文请求的 prefill 阶段可能很久才吐首 token，这是合法的，所以保持较宽松的 20 分钟
 * （见 PR #37033）。可通过 `CODEBUDDY_FIRST_TOKEN_TIMEOUT_MS` 覆盖。
 */
export declare const DEFAULT_FIRST_TOKEN_TIMEOUT_MS = 1200000;
/**
 * 流间静默（inter-chunk idle）超时默认值：已经开始吐 token 之后，两个 chunk 之间的最大静默时长。
 *
 * 与首 token 超时**结构上解耦**——两者是相互独立的常量、也可通过独立的环境变量分别覆盖
 * （`CODEBUDDY_STREAM_TIMEOUT_MS` vs `CODEBUDDY_FIRST_TOKEN_TIMEOUT_MS`）。
 * 默认值当前统一为 20 分钟：长上下文 prefill 慢、以及流中大工具输出后模型侧的短暂静默都属
 * 可容忍场景，一次性 5 分钟阈值容易在长任务里误判为死连接。
 *
 * 如某链路（易半开的网关 / 代理）需要更早识别僵死连接，可通过 `CODEBUDDY_STREAM_TIMEOUT_MS`
 * 单独下调，首 token 超时不受影响。历史踩坑（session dcb9a3c5, 2026-07-06，短阈值方案）
 * 参见 `scripts/reproduce/stream-midstream-stall-hang/`。
 */
export declare const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 1200000;
/**
 * 从环境变量解析超时毫秒数，非法值（空/非数字/<=0）回退到默认值。
 * 提取成纯函数便于单测，见 model-provider.spec.ts。
 */
export declare function resolveTimeoutMs(envVal: string | undefined, defaultMs: number): number;
/** 退避基数：首次重试约等 1s，之后指数增长。 */
export declare const REQUEST_RETRY_BASE_DELAY_MS = 1000;
/** 本地退避的单次上限（未开启 watchdog 时）：封顶 32s。服务端要求的等待不受此限制。 */
export declare const REQUEST_RETRY_MAX_DELAY_MS = 32000;
/** 请求级最大重试次数默认值：8 次。网关允许重试时固定用它；无策略时可用 CODEBUDDY_MAX_RETRIES 覆盖。 */
export declare const DEFAULT_REQUEST_MAX_RETRIES = 8;
/** 请求级最大重试次数上限（对齐 Claude Code 的 15 上限）；超出一律 clamp。 */
export declare const MAX_REQUEST_MAX_RETRIES = 15;
/** watchdog（无限重试）模式下的本地退避封顶：5 分钟。 */
export declare const WATCHDOG_MAX_BACKOFF_MS: number;
/** 401 无脑重试的默认固定间隔：2s（代理侧换一次 token 的量级）。 */
export declare const DEFAULT_MODEL_401_RETRY_DELAY_MS = 2000;
/**
 * 解析请求级最大重试次数：读环境变量 `CODEBUDDY_MAX_RETRIES`，默认 8，clamp 到 [0, 15]。
 * 非法值（空/非数字/负数）回退默认值。运行时读 env（遵循 prewarm live-read 契约），提取纯函数便于单测。
 */
export declare function resolveRequestMaxRetries(envVal: string | undefined): number;
/**
 * 是否开启 watchdog 无限重试模式：读环境变量 `CODEBUDDY_RETRY_WATCHDOG`（`1`/`true`/`yes`，大小写不敏感）。
 * 仅对 429/5xx 生效，用于 CI / 无人值守场景；退避仍受 WATCHDOG_MAX_BACKOFF_MS 封顶。
 */
export declare function isRetryWatchdogEnabled(envVal: string | undefined): boolean;
/**
 * 解析模型请求 401 的无脑重试次数：读环境变量 `CODEBUDDY_MODEL_401_MAX_RETRIES`，**默认 0（关闭）**。
 * clamp 到 [0, 15]（与请求级重试共用上限），非法值（空/非数字/负数）回退 0。
 *
 * 默认 0 是本能力的安全边界：未显式 opt-in 时 401 的处理逐字节保持原样（不重试、直接上抛成
 * authRequired），只有宿主明确声明"我这条链路的 401 可能是鉴权代理抖动"才开启。
 */
export declare function resolveModel401MaxRetries(envVal: string | undefined): number;
/**
 * 解析 401 无脑重试的固定间隔：读环境变量 `CODEBUDDY_MODEL_401_RETRY_DELAY_MS`，默认 2000ms，
 * clamp 到 [0, REQUEST_RETRY_MAX_DELAY_MS]。非法值回退默认值。
 *
 * 刻意是**固定间隔**而非指数退避 + jitter：401 没有 `Retry-After` 语义，代理侧换 token 是个
 * 近似常量的窗口，退避到 32s 只会把一次可恢复的抖动拖成用户可感知的长时间卡顿。
 */
export declare function resolveModel401RetryDelayMs(envVal: string | undefined): number;
/**
 * 计算请求级重试的退避毫秒数。
 * - 若服务端给了等待时间（retryAfterMs != null），原样尊重它，不截短到 maxDelayMs；
 * - 否则指数退避 `BASE * 2^(attempt-1)`，再打散 25% 抖动（`[0.75x, 1x]`，对齐 openai SDK
 *   client.ts 的 `1 - Math.random() * 0.25` 写法：**下减**而非上加，保证结果不越过 maxDelayMs）。
 * attempt 从 1 起。本地退避恒 <= maxDelayMs；服务端等待更久时以服务端为准（对齐 Codex）。
 * 提取纯函数便于单测（注入可控 random）。
 */
export declare function computeRequestRetryDelayMs(attempt: number, retryAfterMs: number | null, maxDelayMs?: number, random?: () => number, baseDelayMs?: number): number;
/**
 * 合并两处服务端等待：HTTP `Retry-After`（相对 now 的毫秒）与 `retry_policy.retry_after`
 * （读错误体时固定下来的绝对时刻）。两者都有时取更晚者；都没有或都已过去返回 null。
 */
export declare function resolveServerRetryDelayMs(headerRetryAfterMs: number | null, policyRetryAfterAt: number | undefined, now?: number): number | null;
/**
 * 自动恢复轮的首 token 时限默认值：5 分钟。
 *
 * 首次请求的 20 分钟是为了容忍长上下文 prefill 慢吐首 token；恢复轮是在上游已经失败过一次
 * 之后的续跑，再等满 20 分钟对用户来说几乎等同于卡死。这是产品取舍而不是技术推论：慢模型 /
 * 超长上下文在恢复轮更容易被判超时，若观测到恢复轮超时占比异常，应先调这个阈值而不是加次数。
 * 可通过 `CODEBUDDY_RECOVERY_FIRST_TOKEN_TIMEOUT_MS` 覆盖，且永远不超过首次请求的首 token 时限。
 */
export declare const DEFAULT_RECOVERY_FIRST_TOKEN_TIMEOUT_MS: number;
export declare function resolveRecoveryFirstTokenTimeoutMs(recoveryEnvVal: string | undefined, firstTokenTimeoutMs: number): number;
/**
 * 构造一个「流体立即以首 token 超时报错」的 SSE 响应。
 *
 * 响应头之前的首 token 超时若以 fetch 异常抛出，SDK 会把它包成连接错误，StreamTimeoutError
 * 的类型与文案都会丢失，会话层就认不出这是可重试的首 token 超时。借用流体报错这条通道，
 * 与 SSE 阶段的首 token 超时完全同构：SDK 迭代流时原样抛出该错误。
 */
export declare function createFirstTokenTimeoutResponse(timeoutMs: number): Response;
export interface MockE2EResponseDiagnostics {
    traceId?: string;
    requestId?: string;
    matchSource?: string;
    matchResult?: string;
    offset?: string;
    responseId?: string;
    finishReason?: string;
    dataVersion?: string;
    instance?: string;
    contentKind?: string;
}
/** Extracts opt-in headers emitted by mock-llm-server without logging response content. */
export declare function extractMockE2EResponseDiagnostics(headers: unknown): MockE2EResponseDiagnostics | undefined;
export declare class ModelProviderImpl implements ModelProvider {
    protected readonly restOperations: RestOperations;
    protected readonly authenticationManager: AuthenticationManager;
    protected readonly productManager: ProductManager;
    protected readonly abTestService?: AbTestService;
    protected readonly sessionManager: SessionManager;
    protected readonly modelRequestRetryPhase: ModelRequestRetryPhase;
    protected readonly telemetryService: TelemetryService;
    protected readonly clientInfoProvider: ClientInfoProvider;
    protected readonly agentManager: AgentManager;
    protected readonly logger: Logger;
    protected readonly traceService?: TraceService;
    protected readonly defaultInputItemProcessor: DefaultInputItemProcessor;
    protected readonly functionCallResultAgentInputItemProcessor: FunctionCallResultAgentInputItemProcessor;
    protected readonly modelErrorAnalyzer: ModelErrorAnalyzer;
    protected readonly settingsManager: SettingsManager;
    protected readonly modelRequestProcessors: ModelRequestProcessor[];
    protected readonly sensitiveModelBoundary: SensitiveModelBoundaryInterface;
    protected readonly securityReviewGate?: ISecurityReviewGate;
    protected readonly aiccModelBoundary?: AiccModelBoundaryInterface;
    protected readonly imageBlobService: ImageBlobService;
    protected readonly galileoTimingHook: GalileoTimingHook | undefined;
    protected readonly galileoService: GalileoService | undefined;
    protected modelCache: Map<string, Model>;
    /**
     * Decode an axios request body for the CODEBUDDY_DEBUG_REQUEST debug log.
     *
     * The body reaching this point may be:
     * - a JSON string (uncompressed) → parse directly
     * - a plain object → return as-is
     * - a gzip-compressed Buffer/Uint8Array (GzipRequestProcessor ran) → gunzip
     *   then parse, so the debug log shows plaintext instead of a byte array.
     *
     * Best-effort: any failure falls back to returning the raw value so the
     * caller's try/catch still logs something rather than throwing.
     */
    private decodeDebugRequestBody;
    /**
     * 解析本轮请求要带的 prompt cache 档位（issue #53191），**会话级 latch**。
     *
     * 默认 `'long'`（1 小时 TTL）；env `CODEBUDDY_DISABLE_PROMPT_CACHING_1H` 为 truthy 时
     * 退回 `'short'`（服务端默认的 5 分钟，不是完全禁用缓存）。
     *
     * truthy 判定走 {@link BooleanUtils.isTruthy}（`1`/`true`/`yes`/`on`，大小写不敏感 + trim），
     * **不要**退回手写 `=== '1' || === 'true'`：这个开关关系到积分花费，用户写 `TRUE` / `yes`
     * 却静默不生效会继续按 1h 的 cache write 单价计费，失败方向不可接受。
     *
     * latch 到 session 而非每次重算：档位直接决定上游 prompt cache 的 TTL，会话中途翻转
     * （例如 settings 热更新）会让上游按新 TTL 重新建缓存、把已经建好的整块作废。
     * 这与 claude-code 把 1h 资格 latch 到 bootstrap state 是同一个理由。
     */
    protected resolveCacheRetention(session: Session, settingsEnv?: Record<string, string>): 'disabled' | 'short' | 'long';
    /**
     * 是否为「本地自定义模型」——来自本地 models.json、接入地址必须由用户自己配置的条目。
     *
     * 刻意只认 `custom-local:` 前缀，比 {@link isCustomModelRequest} 窄，**不可替换成后者**：
     *
     * - `custom-local:` 唯一由 `CustomModelsProductProvider` 给本地 models.json 条目添加，
     *   这类模型的 url 只能来自用户配置，缺了就没有任何可用去处。
     * - `custom:` 是服务端托管的企业自定义模型。服务端下发给客户端的条目**本来就没有 url
     *   和 apiKey**（见 `services/cmd/copilot/app/path/api/configserver/config_v3.go`
     *   `transformModelConfigs` 构造的 `modelData`），真实地址与密钥存在企业库，请求必须
     *   发往产品网关、由 modelhub 的 `CustomResolver` 查库后转发。按「缺 url」拦掉它
     *   会直接打断企业自定义模型功能。
     * - `trustLevel` / `tags` 同样不能用来区分：服务端下发的 tags 取自模型的 `Type` 字段，
     *   而该字段的合法取值之一就是 `'custom'`。
     *
     * ⚠️ 本判定隐式依赖 `ProductFeature.CustomModelIdPrefix` 开启。前缀是由
     * `CustomModelsProductProvider` 有条件添加的（`shouldPrefixId` 取自该 feature，**缺省即
     * false**），flag 关闭时本地条目不带前缀，本判定恒为 false、守卫随之失效并退回「回落网关
     * 换 11102」的旧行为。当前 `build/patches/` 下全部产品变体都显式设为 true；新增变体时
     * 必须一并配置。不拿 `tags` 兜这个场景，理由见上一条。
     */
    protected isLocalCustomModelRequest(modelId?: string, modelConfig?: LanguageModel): boolean;
    protected shouldApplyInternalModelRequestHeaders(modelId?: string, modelConfig?: LanguageModel, isCustomModelRequest?: boolean): boolean;
    /**
     * 下发客户端随本轮 prompt 透传、经 AgentController 前缀白名单过滤后写入
     * `session.requestOptions.customPassthroughHeaders` 的自定义 header。
     *
     * 与 internalModelRequestHeaders 相同的 custom-model 门控：**绝不下发到第三方/自定义模型
     * 端点**。这些是「发给官方 gateway 的外部载荷」而非 copilot 内部遥测 header，故刻意不纳入
     * CODEBUDDY_SKIP_INTERNAL_HEADERS 的清理列表。安全边界是部署方拥有的前缀白名单
     * `CODEBUDDY_PASSTHROUGH_HEADER_PREFIXES`（须与内部 `X-*` header 命名空间不相交）；另外本
     * 调用点位于 per-request 唯一 ID 重置之前，故客户端无法覆盖 X-Request-Id /
     * X-Conversation-Message-Id 等 ID（无论前缀如何配置）。
     */
    protected applyCustomPassthroughHeaders(headers: Record<string, string>, session: Session, modelId?: string, modelConfig?: LanguageModel, isCustomModelRequest?: boolean): void;
    private isRecord;
    private mergeRequestProviderData;
    /**
     * 把调用方（ACP prompt `_meta['codebuddy.ai'].extraFieldsMeta`）透传的不透明对象注入到
     * 本次请求体最后一条 role==='user' 的 message 的 `extra_fields._meta`。
     *
     * 为什么在 message 级而非请求体根：model gateway（modelhub）仅在 message 级读取
     * `extra_fields`（ChatMessage.ExtraFields），请求体根没有该字段、会被丢弃。放到本轮
     * user message 上，与 gateway 在 assistant delta 上回吐 `extra_fields._meta` 的形状对称。
     *
     * 合并而非覆盖：保留已有的 `extra_fields`（如推理链 reasoning_detail / thought signature
     * 回环），仅在 `_meta` 层浅合并，透传调用方给的内部键。
     *
     * 返回是否发生了改动。
     */
    private injectRequestExtraFieldsMeta;
    private resolveRootRequestId;
    /**
     * 子 Agent / team member 的直接父会话 ID，用于 X-Parent-Conversation-ID。
     * 主 Agent 的 meta 里没有该字段，返回 undefined（不带头）。
     */
    protected resolveParentConversationId(session: Session): string | undefined;
    /** Claude Code's compaction gateway hints; trigger / id / count go to `chat_message_send`. */
    protected applyCompactionHeaders(headers: Record<string, string>, compaction: ModelCallCompaction | undefined): void;
    protected getHeaderCaseInsensitive(headers: Record<string, string>, key: string): string | undefined;
    protected deleteHeaderCaseInsensitive(headers: Record<string, string>, key: string): void;
    /**
     * 大小写不敏感地写入 header：先删掉**所有**大小写变体，再按入参 `key` 的原样大小写写入。
     *
     * 因为删除是全变体的，同一个归一化名字下永远只可能有一个键（不会出现
     * `X-Private-Data` 与 `x-private-data` 并存）；反过来，最终落盘的**大小写以入参为准**——
     * 想改变发送时的大小写，改调用方传入的常量，不要指望这里做归一化。
     */
    protected setHeaderCaseInsensitive(headers: Record<string, string>, key: string, value: string): void;
    /**
     * X-Private-Data 的最终下发策略（策略唯一真源；在所有 header 合并之后、transformRequest 之前执行。
     * 跳过内部头时，下方 transformRequest 的兜底清理还会按清理集再删一次该头，属机械兜底而非策略）。
     *
     * 三态：
     *  - **删除**：自定义模型，或显式跳过内部头（`CODEBUDDY_SKIP_INTERNAL_HEADERS`）。
     *    这两类请求的目标不保证是平台网关（可能是用户自配的第三方公网 API）；而该头是
     *    「客户端 ↔ 官方服务端」之间的私有协议（见 `@genie/core` 的 PRIVATE_DATA_HEADER 定义：
     *    服务端据此决定是否将请求纳入训练数据采集）。发给不消费它的 endpoint 既无意义，
     *    也会把用户的优化偏好外泄给第三方。
     *    该取舍**先于**隐私锁定：被锁定的会话在这两种形态下同样不下发。
     *  - **强制 'true'**：会话已锁定（命中企微/微信聊天记录分享标记）→ 隐私数据，不允许用于模型优化。
     *  - **不动**：保持 `getCustomHeaders` 按「帮助优化模型」设置算出的取值。
     *
     * 因此「锁定后所有模型请求都带 true」的准确口径是：
     * **非自定义模型、且未显式跳过内部头的**模型请求才强制 `true`。
     */
    protected applyPrivateDataHeaderPolicy(headers: Record<string, string>, session: Session | undefined, isCustomModelRequest: boolean, shouldSkipInternalHeaders: boolean): void;
    /**
     * 解析 SSE chunk，一次扫描同时检测有意义的模型输出和 finish_reason
     *
     * - hasContent: choices 中包含非空 delta.content/tool_calls/reasoning 等有意义字段，或非空 finish_reason
     * - hasReasoning: 当前 chunk 含非空 `delta.reasoning_content` / `delta.reasoning`。
     *   合并 SSE 帧时 finish_reason="error" 分类必须看这一帧，不能只依赖上一帧留下的
     *   firstMeaningfulTokenReceived（issue #63761 / #122115）。
     * - hasSubstantiveContent: 仅当收到 text (`delta.content`) / tool_calls / refusal 非空时置 true。
     *   **reasoning 不计入** —— reasoning 无法承载最终输出（SDK 拿它去 getTurnInput 也没有对应 message
     *   载体）。这个字段专用于识别 "reasoning-only + upstream error" 的畸形收尾（issue #63761）：
     *   `@openai/agents-openai` 的 streaming 转换器在 `state.reasoning` 非空时会 push 一个 content 为
     *   空数组的 assistant message，随后 `@openai/agents-core` `utils/messages.js:18` 读取
     *   `content[-1].type` 会 TypeError。命中该字段为 false + `finish_reason="error"` 的 chunk
     *   会走 EmptyStreamError 重试管道兜底，不让畸形响应流入 SDK。
     * - finishReason: 模型逻辑完成标志的具体值（如 "stop"、"end_turn"、"tool_calls"、"length"），
     *   未检测到时为 null。收到 finish_reason 表示模型响应已逻辑完成，
     *   即使 SSE 流未正常关闭（未收到 [DONE]），也不应视为超时错误
     * - hasUsage: chunk 中包含 usage 尾帧。usage 可能晚于 finish_reason 到达。
     * - chunkId: chat.completion.chunk 的 id 字段（如 "79d3f668-..."），供自定义模型埋点
     *   透传到后端做链路对齐。未解析到时为 undefined。
     *
     * 注意：
     * - finish_reason="" 是某些网关（如 4.7-1m 链路）的占位/心跳帧，必须忽略，
     *   否则会触发宽限期关流导致对话中途截断
     * - delta.role 字段不参与 token 判定（仅 content/reasoning/tool_calls 非空才算 token），
     *   避免 role="assistant" 占位帧被误判为首 token
     *
     * @param chunk - nodeStream.on('data') 收到的原始 Buffer
     */
    private parseSSEChunk;
    /**
     * 规范化 SSE 流中 tool_calls delta 的 id 字段。
     *
     * 某些模型（如 Kimi）在每个流式 chunk 的 tool_calls delta 中都重复发送 id，
     * 而 @openai/agents-openai 的 convertChatCompletionsStreamToResponses 用
     * `if (tc_delta.id)` 来判断新工具调用。重复 id 导致创建多个空 name 的 function_call。
     *
     * 修复：记录已见过的 tool_call id，对后续 chunk 中重复出现且已带 index 的 id 移除。
     * 如果重复 id 的 delta 没有 index，id 是唯一归属锚点，必须保留给 SDK 按 id 续拼参数。
     *
     * 同时清洗工具名里混入的 XML 标签残片（如 `Bash</arg_value>`），否则 SDK 抛
     * `Tool ... not found` 直接判整轮失败。
     */
    protected normalizeStreamingToolCallIds(text: string, seenToolCallIds: Set<string>): string;
    /**
     * 创建单条 SSE 流的文本处理器：跨 chunk 流式解码 UTF-8 + tool_call id 去重。
     *
     * 网络层 chunk 边界是任意的，可能落在多字节 UTF-8 字符（如中文 3 字节）中间。
     * 对单个 chunk 直接 toString('utf-8') 会把不完整的字节序列立即替换为 U+FFFD(�)，
     * 重编码入队后乱码永久进入下游会话内容与历史。因此用 Node 标准的 string_decoder
     * 跨 chunk 缓存：write() 只返回已完整解码的部分，末尾残缺字节留到下一个 chunk。
     *
     * 流正常结束时须调用 flush() 吐出解码器内可能残留的字节（规范的 SSE 以换行结尾，
     * 通常为空），避免静默丢字节。
     */
    protected createStreamingTextProcessor(): {
        process(chunk: Buffer): Uint8Array | null;
        flush(): Uint8Array | null;
    };
    private parseCustomHeaders;
    /** 客户端构造与请求头使用相同的 API Key 来源和优先级。 */
    private resolveConfiguredApiKey;
    private getCustomHeaders;
    /**
     * 本轮请求是否开启思考（决定要不要补 `reasoning_summary`）。
     *
     * 判据用**当次请求的模型**（#126215）：会话级切过模型后（ACP `set_model` / `/model`），
     * 请求模型与默认 agent 的模型可以不是同一个，按默认 agent 判会把 reasoning 字段发给
     * 不支持它的模型（或反过来漏发）。解析不到请求模型时回退默认 agent（原行为）。
     */
    private enableThinking;
    private injectReasoningSummaryIfNeeded;
    /**
     * 判断一个失败是否是"TCP 连接被中间层/对端切断"且"上游尚未开始处理"的场景。
     *
     * 只有同时满足下面两组条件才认为是安全可重试：
     *   1. 错误码或消息是典型的建连失败：ECONNRESET / socket hang up / ECONNREFUSED
     *      / EAI_AGAIN / ETIMEDOUT（DNS 或建连层）/ EPROTO（TLS 握手层）/ UND_ERR_SOCKET
     *   2. 此时 axios 还没拿到 HTTP 响应头（`error.response === undefined`）
     *
     * 第 2 条是关键的安全边界：一旦 response 到手（无论后续流是否中段），
     * 说明服务端已经接收请求并可能已开始推理，此时重试会触发"从头再算一遍"，
     * 导致 token 账单放大（见 buildOpenAIClientOptions 里 2026-04-24 的背景注释）。
     *
     * 对 2026-04-25 的 case（nginx 499 + body_bytes_sent=0 + upstream_status=-），
     * axios 在收到响应头之前 Node http 就抛 socket hang up，命中本条件，允许重试。
     */
    private isConnectionLevelRetryableError;
    private applyChatFailoverOrigin;
    /**
     * 拦截器已经切过备站（或同 turn 的容灾 SSE 仍在飞）时，
     * ModelProvider 不再对 408/502/503/504（拦截器会重放的状态）发起第二轮 POST。
     * 重放标记写在 axios 合并后的 config 上，所以同时看 error.config。
     * 拦截器未装上时（单测 mock request）仍走下面的请求级重试。
     */
    private shouldSkipRequestLevelRetryAfterChatOriginReplay;
    /**
     * 判断"已收到响应头但流尚未开始"的失败是否属于请求级可退避重试。
     *
     * 与 isConnectionLevelRetryableError 互斥：那条要求 error.response === undefined（连接级）；
     * 本条要求上游返回了非 2xx 响应头。axios 对非 2xx 一律抛错，此时还没进入 SSE 消费，
     * 因此重试不会重发已产出的流内容（零 token 成本）。见文件顶部请求级重试常量注释。
     *
     * 判定优先级（Issue #77910，429 白名单来自内部网关策略）：
     *   1) 额度耗尽先排除 → 不重试（秒级不恢复，交 FallbackModelErrorInterceptor 换模型）。
     *      对自定义第三方模型同样生效：命中的是 insufficient_quota / billing_hard_limit_reached
     *      之类的**供应商文案**，不依赖内部业务码。
     *   2) HTTP 429 走**白名单**：内部网关把限流、额度耗尽、许可证过期、企业/用户未激活、
     *      会话数超限、Craft 各窗口限频、排队等二十余个码全压在 429 上
     *      （见 services/pkg/errors/code/http_code.go），其中只有"瞬时 / 短窗口限流"值得退避重试：
     *      14003 RateLimitError 与 Craft 秒 / 分窗口 6001/6002/6005/6006（退避 ≈ 96s 能等到窗口滑过）；
     *      其余（额度耗尽、许可证/激活、会话数、Craft 时/天窗口、排队）退避满配额也不会恢复。
     *      故自有/官方模型必须 body 带上述白名单码才重试；自定义第三方模型不认这套内部码
     *      （其网关的 429 通常是裸的、无业务码），沿用"见 429 即重试"。
     *   3) 其余状态码交给 isRequestLevelRetryableStatus 统一裁决：5xx / 408 / 409（与业务码无关的
     *      服务端故障 / 超时 / 锁冲突）→ 重试；其它一律不重试。非 429 却带白名单码（这些码与 429
     *      绑定下发，解绑即视为异常或第三方巧合）也落到这里 → 不重试。
     *      500 / 504 只在真实 HTTP 响应头阶段重试；Responses 在 200 流里报的早期错误只认 429，
     *      其它（如 server_error 映射的 500）按原样上抛，交会话层既有恢复。
     *
     * 前置条件：调用方需已 await readErrorBodyOnce(error)，把流式错误 body 读成字符串挂回
     * error.response.data，否则拿不到 body code。读 body 失败时 fail-open 保持原样，此时 429
     * 因无从确认白名单码而**不重试** —— 白名单下这是有意的保守选择，错误仍会上抛交 fallback 换模型。
     */
    private isRequestLevelRetryableError;
    /**
     * 从 error.response.data 解析出业务错误 body 对象（供ErrorUtils.* 读 code/msg）。
     * data 可能是字符串（已 drain）或对象；字符串走 JSON.parse，失败返回 undefined。
     */
    private parseErrorResponseBody;
    /**
     * 网关要求重试（`retry_policy` 且 `retry !== false`）时的「已切过备站就不再叠加」判断。
     *
     * 与 shouldSkipRequestLevelRetryAfterChatOriginReplay 分开：那个 helper 只对 408/502/503 看重放
     * 标记，主站 502 → 备站返回白名单 429 时会放行；网关允许重试后这条链路还会再退避多次。这里不看
     * 状态码，只看这次请求是否已经重放过。重放标记由拦截器写在 axios 合并后的 config 上，所以同时看
     * error.config。无策略路径继续用旧 helper，行为不变。
     */
    private hasChatOriginReplayed;
    /**
     * 可中断的 sleep：等待 ms 毫秒；若 signal 在等待中触发 abort，则立即 clearTimeout 并 reject（不吞取消）。
     * 模型层无共享 sleep 工具（session-* 各有私有 delay），故在此局部实现，供请求级退避重试使用。
     */
    private abortableSleep;
    /**
     * 包装 restOperations.request，做两类"生成开始前"失败的重试，均不会重发已产出的流内容
     * （axios 拿到响应头前抛错=上游未开始生成；拿到非 2xx 响应头也未进入 SSE 消费）：
     *
     * 1) 连接级失败（error.response === undefined 且命中 isOriginReplayRetryable 的传输错误，
     *    不含 DNS 解析失败）：最多 3 次透明重试，1s 起步 2 倍退避且可取消。这是唯一不写会话历史、
     *    不触发 Stop hook 的重试层；但「没拿到响应头」证明不了服务端没开始处理，重发仍可能
     *    重复计算，这是明确接受的取舍。耗尽后的错误经 analyzer 归一化为 HTTP 502 上抛，不会再由
     *    会话层的网络重试接力（那边只认原始 errno）。
     * 2) 请求级失败（502/503/408/409，以及 body 带白名单限流码的 429）：指数退避 + jitter + 尊重
     *    服务端等待的重试（Issue #77910）。500/504 也在范围内（对齐 Codex），57x 不重试。
     *    无网关策略时次数由 CODEBUDDY_MAX_RETRIES（默认 8/上限 15）控制。
     *    CODEBUDDY_RETRY_WATCHDOG=1 时无限重试但退避封顶（CI/无人值守）。
     *    错误体带网关 retry_policy 时以网关为准：retry 为 false / "false" 不重试（鉴权刷新也不做）；
     *    否则在同一白名单内固定 8 次。两条路径都是 1s 起步 2 倍退避、单次封顶 32s；HTTP Retry-After
     *    与 retry_policy.retry_after 取更晚者，服务端要求更久时不截短。退避期间投影 retrying 状态。
     * 3) 401 无脑重试（**默认关闭**，需 CODEBUDDY_MODEL_401_MAX_RETRIES 显式 opt-in）：为「cbc 前面挂了
     *    注入 Bearer 的鉴权代理」的部署兜底 —— 例如沙箱链路 cloudagent → sandbox-proxy → cbc →
     *    auth.proxy → modelhub，token 由 auth.proxy 持有并续期，cbc 本地那份只是占位串。这种链路上
     *    一次 401 通常是代理侧换 token 的瞬时抖动，本地既无法刷新（下面的鉴权刷新拿不到 run identity）
     *    也不该当成"需要重新登录"。按固定间隔（CODEBUDDY_MODEL_401_RETRY_DELAY_MS，默认 2s）重试。
     *    仅对非自定义模型生效：第三方自定义模型的 401 是用户自己的 key 失效，重试只是纯加延迟。
     *
     * 三类预算分开计数，避免连接级抖动吃掉请求级配额。请求一旦成功返回（含流式 200），
     * 后续 stream 中段断开不在这里重试——交给调用方（SessionManager / 用户重试 / FallbackModelErrorInterceptor）。
     * AbortSignal 已触发时一律不重试（尊重取消语义）。env 运行时 live 读（prewarm 契约）。
     */
    private requestWithConnectionRetry;
    /**
     * 自定义模型的上游请求 ID 只在响应头里，失败日志附上白名单内的头供找服务方排障；平台模型或无命中时返回空串。
     */
    private formatUpstreamDiagnosticHeaders;
    private logModelCallCompletion;
    private modelCallFinishReason;
    private getModelTracer;
    /**
     * MVP 验证：agent-cli 模型请求最终走 OpenAI SDK 的自定义 fetch adapter，
     * 不一定会被 Galileo SDK 的 global fetch/http instrumentation 捕获。
     *
     * 这里在真正发出 axios 请求前手动创建一个 OTel client span，并从
     * TraceStartHook 注入的 B3 headers 恢复父级 trace。伽利略后台同一
     * traceId 下应出现 `codebuddy_code.model_request`。
     *
     * 注意：span 覆盖「发起请求 → 收到响应头」阶段；SSE 全量消费耗时仍由现有
     * galileoTimingHook 指标记录，后续若需要再扩展完整 stream span。
     */
    private runWithGalileoModelRequestSpan;
    /**
     * Resolve the local model-span parent from the admitted turn first.
     *
     * `session.requestOptions.headers` is a transport cache and can be updated
     * by unrelated HTTP side channels. The turn context is the request-owned
     * source of truth. B3 remains a compatibility fallback for legacy callers
     * that invoke the provider outside a turn scope.
     */
    private resolveModelSpanParentContext;
    /**
     * 创建流式响应读取阶段的独立观测 span（`codebuddy_code.model_stream`）。
     *
     * 背景：`codebuddy_code.model_request` 只覆盖到收到 HTTP 响应头（TTFT），响应头之后的
     * 完整流式读取阶段此前没有任何 span/event 覆盖。Galileo 生产 trace 实测显示该阶段可占
     * model_request 自身耗时的 60%~90%，是排查“模型吐字慢/网络卡”时最大的黑盒。
     *
     * 设计：
     * - 与 `model_request` 共享同一个 parentContext（兄弟 span，不是子 span），因为
     *   model_request 在收到响应头时已经 end() 关闭。
     * - 不逐 chunk 建 span，只在首 token、周期进度、流结束等关键节点打点 event，避免 span 膨胀。
     * - 创建失败 fail-open，返回的 endSpan 为空操作，不影响原有流式处理逻辑。
     */
    private createModelStreamSpan;
    /**
     * 一次性把请求侧的中性 `llm.*` 属性写到 model_stream span（仅 OTEL_SEMCONV=agentlens 时调用）。
     * 只读 parsedBody、只写 span，不改写出站请求；异常在调用方 try/catch 兜底。
     *
     * messages 逐条索引展开为 `llm.prompt.[i].role/content/tool_call_id/tool_calls.[j].*`，
     * 供 exporter 映射为 agentLens 要求的 `gen_ai.prompts.[i].*`（它靠这些索引属性还原
     * user/assistant/tool 多轮消息，而非解析整坨 input.value）。
     * 元数据（role/tool_call_id/tool_calls 结构）始终写；content 受 OTEL_LOG_USER_PROMPTS 门控。
     * 单条 content 硬截断 LLM_SOURCE_PROMPT_VALUE_MAX_SIZE、整体 input.messages 截断
     * LLM_SOURCE_VALUE_MAX_SIZE，最多展开 MAX_PROMPT_MESSAGES 条（见方案 §10.3）。
     */
    private writeGenAiRequestAttrs;
    private injectOtelSpanHeaders;
    private sanitizeUrlForTrace;
    protected axiosToFetchAdapter(): typeof fetch;
    protected createClient(baseURL: string, apiKey?: string): Promise<OpenAI>;
    /**
     * 构建 OpenAI SDK 构造选项。
     *
     * **关键决策：maxRetries 必须为 0，禁用 SDK 自动重试。**
     *
     * 背景（2026-04-24 17:48 db53291e session 调查）：
     *  OpenAI Node SDK 默认 maxRetries=2，在网络层异常（含 streaming 中段
     *  断开如 `socket hang up` / `ECONNRESET`）时会自动重发整个请求。
     *  在流式场景下，即使模型已经吐出了几十 KB token，SDK 仍会从头重发整个
     *  prompt，导致：
     *
     *  1) 模型服务端被触发 N 次完整 generation（用户看 1 次发送，trace 平台
     *     看 3 条 generation；token / 配额 / 计费按 N 倍放大）
     *  2) 重试不在我们的 cancel/owner 体系内，无法被 SessionManager 中止
     *  3) 三次共享同一 X-Request-Id，但 conversationMessageId 不同，trace 链
     *     混乱
     *
     *  我们的恢复策略由上层用户重试承担，
     *  这里禁用 SDK 自动 retry 把控制权完整交回应用层。
     *
     *  对应日志特征：
     *    [ModelProvider] Sending request: requestId=<X>     ← 第 1 次
     *    [ModelProvider] Request failed: error=socket hang up
     *    [ModelProvider] Sending request: requestId=<X>     ← 第 2 次（SDK 自动 retry）
     *    [ModelProvider] Request failed: error=socket hang up
     *    [ModelProvider] Sending request: requestId=<X>     ← 第 3 次（SDK 自动 retry）
     *    [ModelProvider] First raw chunk received
     *
     *  上面 3 次共享同一 requestId 即 SDK 自动 retry 的指纹。修复后只会有 1 次。
     */
    protected buildOpenAIClientOptions(baseURL: string, apiKey: string): NonNullable<ConstructorParameters<typeof OpenAI>[0]>;
    /**
     * 解析 OpenAI SDK 自定义 fetch 的超时时长（毫秒）。
     * 配置来源和默认值与首 token 超时保持一致。
     */
    protected resolveRequestTimeoutMs(): number;
    getCacheKey(baseURL: string, modelName: string, apiKey?: string, responsesWire?: boolean): string;
    /**
     * 解析模型请求的 baseURL。
     *
     * 优先级：modelConfig.url > query.options.product.endpoint > CODEBUDDY_BASE_URL > 产品默认 endpoint。
     *
     * 关键修复（IOA/内网环境下 API Key 间歇性 401 "endpoint mismatch"）：
     * 默认 endpoint 取自 `productManager.getEndpoint()`（即 currentEndpoint，会随
     * ClientInternetEnviromentProductProvider 等 endpoint-modifying provider 在 doSync
     * 期间**增量**更新），而**不是** `product.endpoint`。
     *
     * `product.endpoint` 来自 `configuration` BehaviorSubject，仅在 doSync 末尾（等所有
     * provider、含较慢的网络 provider 全部完成后）才 re-emit；切到 IOA 环境时它会短暂滞后于
     * currentEndpoint。此时 ModelProvider 读到的还是默认 host（www.codebuddy.ai），而鉴权层
     * authentication-http-interceptor 用的 `getEndpoint()` 已是 IOA 的 copilot.tencent.com，
     * 两者不同源 → 请求被发往错误 host → 401，且被 "401 ignored (endpoint mismatch)" 守卫吞掉、
     * 误报成 custom model 鉴权失败。统一改用 getEndpoint() 后，模型请求 host 与鉴权层判断始终一致。
     */
    protected resolveModelBaseURL(params: {
        envBaseURL?: string;
        modelConfigUrl?: string;
        productEndpoint?: string;
        modelId?: string;
        modelConfig?: LanguageModel;
        customEndpoint?: string;
    }): string;
    /**
     * 当解析出的 endpoint host 与本次执行的网络环境（CODEBUDDY_INTERNET_ENVIRONMENT）不匹配时，
     * 打印 warn 日志便于排查。仅诊断，不阻断请求。
     *
     * 触发条件：env=ioa 但 endpoint host 落在公共云域名（codebuddy.ai）。
     * 不做严格白名单匹配，避免误报本地代理 / 灰度域名 / 测试环境。
     */
    protected warnIfEnvEndpointMismatch(endpoint: string): void;
    /**
     * Normalize the `output.text` of EVERY freshly-produced tool result to the canonical
     * "bare content" form before the model request — not just the last item.
     *
     * Why all items, not just the last (fix for #63797):
     * A parallel tool-call batch produces several `function_call_result` items in a single
     * turn. Previously only `newItems[last]` was normalized here; the non-last ones stayed
     * in the SDK's envelope form (`toSmartString` of the whole ToolResult, i.e. including
     * `title`/`renderer`) for the current request, and were only rewritten to bare content
     * by the next turn's `addHistory` pass. That per-turn envelope→bare byte flip on the
     * same `tool_call_id` moves the prompt-cache prefix divergence point and tanks cache
     * hit-rate for the first few turns of any parallel / multi-tool subagent run.
     *
     * The processor is idempotent (it early-returns once `providerData.toolResult` is set),
     * so re-visiting already-normalized items from earlier turns is a cheap no-op. Only
     * `function_call_result` items are touched, matching the processor's own guard.
     */
    protected normalizeNewToolResults(newItems: NonNullable<Session['resultSubject']['value']>['newItems'], session: Session): Promise<void>;
    private responsesImageDeps;
    isNetworkReady(modelName: string): Promise<boolean>;
    getModel(modelName?: string): Promise<Model>;
}
