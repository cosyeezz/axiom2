import { type LanguageModel } from '@genie/product';
/**
 * 首期按"非原生多模态"处理的模型：图片不直接进主模型上下文，改为由识图子调用读出内容。
 *
 * 该名单优先于 product 配置的 supportsImages 字段——这些模型的字段仍为 true，
 * 发图会触发服务端路由改派（主模型 cache 失效 + 积分上涨）。
 *
 * 名单构成：issue #111063 §5 的首期 6 个（glm-5.2 / glm-5.3 / hy3 / hy4 /
 * deepseek-v4-flash / deepseek-v4-pro）+ glm-5.1（官方文档标注输入模态仅文本，同属该批）。
 *
 * 匹配规则：按 base id 匹配并允许环境后缀（`-ioa` / `-internal-ioa` / `-dev-0402` 等）。
 * 不写精确 id 是为了覆盖各环境的变体，代价是名字相近的模型会互相误伤，故单独维护排除表。
 *
 * 消费方（三者必须口径一致，改名单时要一起动）：
 * - ViewImage 工具：决定"返回图片本身"还是"交给识图子调用读出内容"
 * - ImageFilter 拦截器：决定"图片照发"还是"换成提示文字引导模型调 ViewImage"
 * - 工具面注入：名单命中的模型必须拿得到 ViewImage（否则提示文字等于空头支票）
 */
export declare const NON_MULTIMODAL_MODEL_IDS: readonly string[];
/**
 * 显式排除：这些模型必须能直接收图，即使命中了上面的 base id 前缀。
 *
 * - `glm-5.3-flash` / `glm-5.3-flashx`：同代的原生多模态模型（产品配置描述一致，
 *   都是「原生多模态模型，擅长视觉理解与专业任务」）。名字会命中 `glm-5.3` 前缀，
 *   需显式排除，避免被前缀匹配误判为非多模态。
 *
 * 注：`deepseek-v4.1-flash` 与 `deepseek-v4-flash` 不同前缀，不会误伤，无需列出。
 */
export declare const NATIVE_MULTIMODAL_MODEL_IDS: readonly string[];
/** 模型是否需要走"图片不进上下文、改由 ViewImage 转述"的路子。 */
export declare function isNonMultimodalModel(modelId: string | undefined): boolean;
export type ImageInputMode = 'direct' | 'relay' | 'omit';
export declare function isCustomModelConfiguration(modelId?: string, model?: Partial<LanguageModel>): boolean;
export declare function getImageInputMode(model: LanguageModel | undefined): ImageInputMode;
