import { ToolDeferOverlaySnapshot } from '../../../vendor/cbc-shared/node/index.js';
export declare const AgentToolDeferOverlayCache: unique symbol;
/**
 * Agent 级 defer overlay 缓存（进程级单例）。
 *
 * 当 agent 的 `tools` 配置（来自 product.json `agents[].tools` 或 custom agent
 * frontmatter `tools:`）中包含 `Defer(...)` / `NoDefer(...)` 修饰时，
 * agent-manager 在第一次构建该 agent 工具集时把解析得到的 overlay snapshot
 * 写入这里，后续所有消费点（filterTools / ToolSearch / DeferExecuteTool / 等）
 * 通过 `get(agentName)` 拿到，再与 session-level overlay 合并。
 *
 * 缓存归属随声明来源决定：
 *   - 普通 CLI 的 agent.tools 来自进程 Product 配置，沿用进程级缓存；
 *   - 解析一次复用即可，避免每次工具检查重新走 parseToolSpecs。
 *   - 显式注入 query Product 时按该快照隔离，同名 agent 不共享 overlay。
 *   - 未显式传入 Product 的 Server 插件组合按会话隔离，模式切换时重建。
 *
 * 之所以是「独立 service」而非「ToolManager 内嵌」：
 *   - 关注点单一（agent overlay cache vs 工具 registry），方便后续扩展；
 *   - 消费点 4 处，单独 @Autowired 比污染 ToolManager 接口更干净。
 */
export interface AgentToolDeferOverlayCache {
    /**
     * 读取指定 agent 的 overlay snapshot。
     * 未注册的 agent / agentName 为 undefined 时返回 undefined（消费方应按 EMPTY 处理）。
     */
    get(agentName: string | undefined): ToolDeferOverlaySnapshot | undefined;
    /**
     * 注册或覆盖某 agent 的 overlay snapshot。
     * agent-manager 在 buildTools 入口处调用一次。
     */
    set(agentName: string, snapshot: ToolDeferOverlaySnapshot): void;
    /**
     * 清空所有缓存（测试 / hot reload 场景）。
     */
    clear(): void;
}
export declare class AgentToolDeferOverlayCacheImpl implements AgentToolDeferOverlayCache {
    private readonly processCache;
    private readonly queryCaches;
    private get cache();
    get(agentName: string | undefined): ToolDeferOverlaySnapshot | undefined;
    set(agentName: string, snapshot: ToolDeferOverlaySnapshot): void;
    clear(): void;
}
