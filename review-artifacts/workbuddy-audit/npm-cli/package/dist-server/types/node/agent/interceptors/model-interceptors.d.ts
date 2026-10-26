import { AgentManager, AgentRunInterceptor, AgentRunInterceptorPriority, AgentRunRequest, Session, SessionManager } from '../../../vendor/cbc-core/node/index.js';
import { Agent } from '../../../vendor/cbc-shared/node/index.js';
import { LanguageModel, ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import { ImageBlobService } from '../../blob-store';
import { SettingsManager } from '../../settings';
export { StateAgentRunInterceptor, ContinueAgentRunInterceptor } from '../../../vendor/cbc-core/node/index.js';
export declare class ModelConfigAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly productManager: ProductManager;
    protected readonly agentManager: AgentManager;
    protected readonly settingsManager: SettingsManager;
    protected readonly sessionManager: SessionManager;
    protected readonly logger: Logger;
    intercept(request: AgentRunRequest): Promise<void>;
    protected getModelByCliOptions(agent: Agent<any, any>, session: Session): Promise<LanguageModel | undefined>;
    protected getModelByRequestOptions(agent: Agent<any, any>, session: Session): Promise<LanguageModel>;
    protected configureModelConfig(agent: Agent<any, any>, session: Session): Promise<void>;
    /**
     * 配置 thinking 相关的 modelSettings（Issue #12554 / §16.4）。
     *
     * 优先级（从高到低）：
     *   1. 会话级 override（SessionManager.getOverrideThinking）— 来自 ACP setSessionConfigOption('thought_level')
     *   2. CLI 参数 / 全局 settings（alwaysThinkingEnabled / reasoningEffort）
     *   3. modelConfig.reasoning.defaultEffort（产品配置兜底）
     *   4. legacy 'high' 兜底
     *
     * 关键设计点：
     *   - thinkingEnabled === false 必须显式短路 + delete agent.modelSettings.reasoning，
     *     否则下面的 modelConfig.reasoning 兜底会把 thinking 又打开（"假关闭"假闭环）
     *   - 'max' 在共享契约里合法。发送前先按当前模型能力把 effort 收敛（Issue #87437），
     *     `toSdkEffort` 只对收敛后的值做类型断言、值不变；SDK 类型枚举虽不含 'max'，
     *     但运行时纯透传（见 toSdkEffort 注释）。#79843
     */
    protected configureThinkingSettings(agent: Agent<any, any>, modelConfig: LanguageModel, session: Session): Promise<void>;
}
export declare class ImageFilterAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly productManager: ProductManager;
    protected readonly imageBlobService: ImageBlobService;
    protected readonly logger: Logger;
    intercept(request: AgentRunRequest): Promise<void>;
    /** 取出可整体替换元素的输入数组：数组形态即 request.input，RunState 形态取其 history。 */
    private resolveMutableItems;
    /**
     * 命中非多模态名单：把图片换成"图存在哪 + 用 ViewImage 读"的提示文字。
     *
     * 返回替换后的新 item（copy-on-write），原 item 保持原图——这样用户切到多模态模型
     * 还能正常发图，切回来继续走 ViewImage。
     */
    private relayImagesToViewImage;
    /**
     * 用户消息里的图片有四种落点形态，按下表全部识别——只认 `input_image` 会漏掉后三种，
     * 而它们在**会话被重载过之后**必然出现（切模型、重启客户端都会重建 CLI 进程）：
     *
     * | 形态 | 出现时机 |
     * |---|---|
     * | `{ type: 'input_image', image: <data URI \| ImageBlobRef> }` | 当轮新发（内存保留 data URI） |
     * | `{ type: 'image_blob_ref', ... }` | 磁盘持久化形态，会话重载后、还原之前 |
     * | `{ type: 'image_url', image_url: { url: <data URI \| ImageBlobRef \| 字符串化 ref> } }` | ImageRehydration 还原引用之后的形态 |
     */
    /** 图片元素形态识别：与 payload 是否可提取分开——提取失败时也要能给出明确省略文案。 */
    private isImagePart;
    private extractImagePayload;
    /** 从 img 字段的值里取出图片载荷：data URI 现用，已落盘引用取路径，其余（外部 URL）视为不可用。 */
    private payloadFromImageValue;
    /** 拿到可用于 ViewImage 的本地路径：已是引用直接读，data URI 则先落盘（内容寻址、幂等）。 */
    private materializeBlobPath;
    /**
     * 配置声明收不了图（`supportsImages === false`，主要是用户自己配的第三方模型）：
     * 图片位置换成一句说明，而不是静默删掉——否则模型既看不到图、也不知道曾经有过图。
     *
     * 这里**不给** ViewImage 引导：这类模型未必支持工具调用，且转述会把用户的图送出他们自己的
     * endpoint 之外——计费口径与隐私边界（本地模型 / 私有化部署）待产品决定，定了再考虑开放。
     */
    private stripImagesFromMessage;
    /**
     * 工具结果里的图片同样维持既有剥离语义。只处理 output（发给模型的正文）；
     * providerData.toolResult.content 是渲染字段，归 ImageRehydration 链路管。
     */
    private stripImagesFromFunctionCallResult;
    /** 过滤 JSON 文本里的图片块；无可过滤内容时返回 undefined。 */
    private filterImagesInOutputText;
}
