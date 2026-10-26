import { AuthenticationManager } from '@genie/authentication';
import { AbTestService, ProductManager } from '@genie/product';
/** 国际集群 endpoint 主机名片段。命中任一即判定为暂不支持 Artifact 分享链路的国际环境。 */
export declare const INTERNATIONAL_ENDPOINT_HOSTS: string[];
/**
 * Artifact / ArtifactControl 共享的开关判定（issue #81031）。
 *
 * 判定顺序（先命中先生效）：
 *   1. 国际 endpoint → 直接关闭（国际网关缺少 spaceengine 接口，任何开关都无法覆盖）；
 *   2. 环境变量：CODEBUDDY_ARTIFACT_ENABLED（新规范名）优先，未设置时回落
 *      CODEBUDDY_SHARE_LINK_ENABLED（旧名，兼容已部署环境）。空串/空白视为未设置——
 *      宿主模板化 env 很容易注入空值，若按「已设置」处理会遮蔽旧变量并静默关闭工具；
 *   3. 云端 productFeatures：优先走调用方注入的 AbTestService（Artifact 权威优先、
 *      ShareLink 兼容兜底；任一 alias 显式 false 触发 kill-switch）；两者均缺失时
 *      本地默认按 true 处理，保留既有"缺省开"的行为。
 *   4. AbTestService 未注入（老bundle / 未装配 CellJS 容器的单测）→ fallback 到
 *      productManager.waitConfiguration()，语义与迁移前完全等价。
 *
 * **不用 `ContainerUtil.get(AbTestService)`懒获取的原因**：CellJS 惰性实例化，
 * 首次 get 才触发 @PostConstruct → warm-up。如果只有 isArtifactToolEnabled 消费它，
 * 那么在无登录/短路径场景下工具从未被 evaluate → AbTestService 从未实例化 → snapshot
 * 从不落盘。改由消费方类（ArtifactTool / ArtifactControlTool）通过 @Autowired 声明依赖，
 * CellJS 装配这些工具时会顺带装配 AbTestService，warm-up 提前发生。
 */
export declare function isArtifactToolEnabled(productManager: ProductManager, abTestService?: AbTestService): Promise<boolean>;
/**
 * 按文件扩展名判定上传 COS 时的 `Content-Type`。
 *
 * 后端 `importLocalFileAsync` 按扩展名分流（见 workbuddy-server `share/facade.ts` 的
 * 「html/md 走 cosKey，其他类型走 confirmKey」注释），`.md` 与 `.html` 同为一等公民并由
 * **服务端**渲染为样式化页面 —— 因此客户端不做任何预渲染，只需给出正确的 contentType。
 *
 * 未识别的扩展名保持 `application/octet-stream`（既有行为，不收窄）。
 */
export declare function resolveShareContentType(filePath: string): string;
/** endpoint 主机名命中国际集群清单时返回 true。 */
export declare function isInternationalEndpoint(endpoint: string): boolean;
/**
 * 构造鉴权头（bearer + X-* 上下文）：运行身份优先（服务模式每轮绑定），缺席时用 CBC
 * 自身的启动登录，与其他运行面消费点同一口径——token 取运行身份的 access token，否则
 * 取启动登录的；运行身份的归因头与宿主头压过启动登录派生的同名头。CLI 进程不绑定运行
 * 身份，结果与只读启动登录相同。没有 Authorization 时返回 null。
 */
export declare function buildShareAuthHeaders(authManager: AuthenticationManager): Record<string, string> | null;
/**
 * 从 Artifact 工具返回的分享链接中解析出 nodeId（即取消发布接口所需的 fileId）。
 *
 * 链接格式稳定为 `.../p/{nodeId}`（见 spaceengine urlgen.PublishURL），因此取 pathname
 * 的最后一段即可。传入的已经是裸 nodeId（不含斜杠、不含协议）时原样返回。
 *
 * 无法解析时返回 null。
 */
export declare function extractNodeIdFromShareLink(input: string): string | null;
/**
 * 分享链接的节点类型：
 * - `page`：HTML 页面节点（`https://workbuddy.link/p/{nodeId}`），取消公开走 page/unpublish；
 * - `doc`：Markdown 文档节点（`https://www.workbuddy.cn/space/d/{nodeId}`），取消公开走
 *   set-permission(invalid)（doc 节点没有 page/unpublish，调之报 "page meta not found"）；
 * - `unknown`：只给了裸 nodeId（无路径可判型），由调用方先试 page 再回退 doc。
 */
export type ShareLinkKind = 'page' | 'doc' | 'unknown';
/**
 * 按链接路径形态判定节点类型，并解析出 nodeId。
 *
 * 判据只看路径段（`/p/` vs `/space/d/`），不依赖 host——host 可能随环境变化
 * （workbuddy.link / workbuddy.cn / copilot.tencent.com 等），但路径形态稳定。
 * 裸 nodeId（无斜杠）无法判型，返回 `unknown` 交由调用方按 page→doc 顺序试探。
 *
 * nodeId 复用 extractNodeIdFromShareLink，避免重复解析逻辑。
 */
export declare function classifyShareLink(input: string): {
    nodeId: string | null;
    kind: ShareLinkKind;
};
