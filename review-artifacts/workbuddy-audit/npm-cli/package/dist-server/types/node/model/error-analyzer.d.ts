import { ProductManager } from '@genie/product';
import { AxiosError } from 'axios';
import { ModelErrorAnalyzer } from './model-protocol';
export declare class ModelErrorAnalyzerImpl implements ModelErrorAnalyzer {
    analyze(error: unknown, axiosConfig: any): Promise<Response>;
    private handleRequestError;
    private handleServerError;
    /**
     * 按优先级从多个层级取某个「多语言文案字段」，并校验形态。
     *
     * 各解析分支的响应体嵌套深度不同（顶层 / `data` / `error.data`），网关把
     * `displayMsg` / `displayTips` 放在与 `code`、`msg` 同级的位置，故先看该层、再回退顶层。
     *
     * 只放行「值全为字符串的普通对象」：CLI 不解析文案内容，但必须挡住数组、
     * 超大字符串等异常形态，避免它们随错误体一路带到前端。
     */
    private pickStringMap;
    private pickDisplayMsg;
    private pickDisplayTips;
    /**
     * 按与 `displayMsg` 相同的层级取 `retry_policy`，只保留普通对象形态。
     *
     * `null`、数组等形态在请求层就按「未设置」处理，这里丢弃不会改变任何一层的裁决；
     * 普通对象原样保留，下游再用 `resolveRetryPolicy` 解读，两层结论一致。
     */
    private pickRetryPolicy;
    /**
     * 取后端下发的用户可见操作枚举数组。
     *
     * 只接受字符串数组，非字符串项逐项丢弃；过滤后为空数组等价于「没有额外操作指引」，
     * 按字段缺失处理（前端据此不渲染任何按钮，与文档口径一致）。
     * CLI 不解释枚举语义，未知枚举保留原样交由前端跳过。
     */
    private pickActions;
    private parseReponse;
    private handleNetworkError;
    /**
     * 网络层失败的归因分类（单一事实源）。
     *
     * code（业务码）与 message（用户文案）都从这里派生，避免两份重复的 error.code 列表
     * 各自演进导致"码与文案对不上"（如码判超时、文案却没超时字样）。
     *
     * 分类口径与 ErrorUtils.mapMessageErrorCode 的网络部分保持一致（连接→3002 / 超时→3003），
     * 但这里只聚焦 handleNetworkError 的纯传输失败场景，不走其全量 5xx/4xx 分支。
     */
    private classifyNetworkError;
    /**
     * 把网络层失败映射为客户端网络业务错误码（从 classifyNetworkError 派生）。
     *
     * - 3002（网络连接失败）：DNS / 无路由 / 拒绝 / 中断 / TLS 握手前断开等"连接类"；
     * - 3003（网络请求超时）：超时类；
     * - 502（兜底）：无法明确归因，保持原占位码，避免把服务端 reset / 未知传输错误甩锅给用户网络。
     *
     * 注意：这里只决定 body 里的业务 code；HTTP status 始终是 502（见 handleNetworkError）。
     * 前端对 3002/3003 已有 i18n 文案与「检测网络」入口（errorCodeI18nKeyMap + ErrorBanner）。
     * 错误码取值见 docs/Agent Craft 错误码文档.md（3002 网络连接错误 / 3003 超时）。
     */
    private mapNetworkErrorCode;
    /**
     * 把网络层失败翻译成面向用户的归因提示（从 classifyNetworkError 派生）。
     *
     * 设计：人类可读前缀 + 保留原始 syscall 文本（括号内），不丢任何排查信息；
     * 'unknown' 回退到 error.message 原文，绝不吞错误。
     * 返回值不含业务码 / target / requestId，这些由上层 handleNetworkError 负责拼接。
     */
    private mapNetworkErrorMessage;
    private handleConfigError;
    private appendProxyInfo;
    private appendAuthInfo;
    /**
     * 判断 401/403 是否来自"自定义模型凭据 / 非平台 endpoint"请求。
     *
     * 用于 Issue #48786：第三方/自定义模型 API key 失效时，避免被上层 ACP 误判为
     * "平台登录失效"而触发"重新登录"弹窗、掀翻 session。
     *
     * 抽出独立方法是为了把 ContainerUtil 取依赖的副作用集中到一处，并方便单测注入。
     * 单测层（TestModelErrorAnalyzer）通过 protected 暴露此方法做隔离测试。
     */
    protected isCustomModelAuthRequest(error: AxiosError): boolean;
    protected getProductManager(): ProductManager;
    /**
     * 判断请求是否指向产品 endpoint 之外的地址。
     *
     * 注意：ProductEndpointHttpInterceptor 会给所有经过 restOperations 的请求注入
     * baseURL = 产品 endpoint，因此 baseURL 不能作为可靠的判断依据。
     * 当 url 是完整的绝对 URL 时（自定义模型场景），应优先用 url 判断实际请求目标。
     *
     * 与 authentication-http-interceptor 的 isEndpointMatch 保持一致的判断逻辑。
     */
    private isNonEndpointRequest;
    /**
     * 从请求体和产品配置中提取模型辅助信息，用于丰富错误提示
     */
    private extractModelInfo;
    /**
     * 构造"请求打到非当前 endpoint host"时的 401 文案。
     *
     * - customUrl 存在 → 用户自定义模型(models.json 配了 url)，引导检查 models.json / apiKey。
     * - customUrl 不存在 → 内置模型却打到了非当前 endpoint 的 host，多半是 endpoint 解析/路由
     *   问题（典型：CODEBUDDY_INTERNET_ENVIRONMENT 切换时模型请求 host 与鉴权层 endpoint 不一致），
     *   此时不再误报为 "custom model"，而是明确指出请求被发往的 host 与当前 endpoint，并给出
     *   CODEBUDDY_BASE_URL 兜底建议。
     */
    private buildNonEndpointAuthMessage;
    /**
     * 从 AxiosError 中解析本次请求实际打到的 host（protocol//host），用于 401 路由问题诊断。
     * 解析失败返回 undefined（调用方会退化为通用文案）。
     */
    private extractRequestHost;
    private appendRequestId;
    private appendModelSupportInfo;
    private isIncomingMessage;
    private safeJSONParse;
    private readStreamData;
    analyzeProxyFromError(error: AxiosError): string;
    private isAxiosError;
    private isCancelledError;
    createErrorResponse(body: string, status: number, statusText: string, headers?: Record<string, string>): Response;
}
