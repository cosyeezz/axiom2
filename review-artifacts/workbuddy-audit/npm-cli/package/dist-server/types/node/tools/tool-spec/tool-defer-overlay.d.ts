import { ToolDeferOverlaySnapshot } from '../../../vendor/cbc-shared/node/index.js';
/**
 * 会话级 defer overlay 的查询封装。
 *
 * 由 ParsedToolSpecs.overlay 构造，挂在 SessionOptions 上，被
 * DeferToolConfigService.isToolDeferLoadingWithOverlay /
 * isBuiltinToolDeferLoading 在判定优先级最高的位置查询。
 *
 * 设计取舍：
 *   - 通配只支持 `*`（与 ToolNames 中 mcp 工具的命名习惯一致），不引入完整
 *     minimatch，避免依赖膨胀与 ReDoS 风险。
 *   - 大小写敏感（与 ToolNames 枚举值的实际形态一致：内置工具大驼峰、MCP 工具
 *     全小写带 __ 分隔）。
 *   - NoDefer 优先于 Defer：用户显式 opt-out 是最强意图。
 */
export declare class ToolDeferOverlay {
    /** 全空 overlay 的复用实例。会话默认值，避免空判分散到各调用方。 */
    static readonly EMPTY: ToolDeferOverlay;
    /**
     * 从 SessionOptions.toolDeferOverlay 读出的 snapshot 构造实例。
     * snapshot 为 undefined 时返回共享 EMPTY，避免每次都 new。
     *
     * SessionOptions 上故意只存 snapshot 而非 class 实例，因为 ACP / `--serve`
     * 模式下 SessionOptions 会跨 JSON 边界，class 方法会丢失。所有消费方在
     * 用 overlay 前必须经此入口。
     */
    static fromSnapshot(snapshot: ToolDeferOverlaySnapshot | undefined): ToolDeferOverlay;
    /**
     * 合并多层 overlay snapshot。典型用法：
     *   merge(sessionOverlay, agentOverlay)
     *
     * 合并语义：
     *   - forceNoDefer：取并集（任一层声明就生效；与 ToolDeferOverlay.decide
     *     里 NoDefer 永远压过 Defer 的语义保持一致）
     *   - forceDefer：取并集
     *
     * 由于 decide 自身已保证 NoDefer 优先，合并阶段无需再"减去 forceDefer"：
     *   假设 agent 写 `Defer(X)`、session 写 `NoDefer(X)`，合并后两个桶都含 X，
     *   decide('X') 仍正确返回 'force-no-defer'。
     *
     * 任何参数为 undefined 时按 EMPTY 处理。返回 EMPTY 是惰性的：所有输入都为
     * 空时直接返回共享 EMPTY 实例，避免热路径上的内存分配。
     */
    static merge(...snapshots: Array<ToolDeferOverlaySnapshot | undefined>): ToolDeferOverlay;
    private readonly forceDeferExact;
    private readonly forceDeferGlob;
    private readonly forceNoDeferExact;
    private readonly forceNoDeferGlob;
    constructor(snapshot: ToolDeferOverlaySnapshot);
    isEmpty(): boolean;
    matchesForceDefer(toolName: string): boolean;
    matchesForceNoDefer(toolName: string): boolean;
    /**
     * 列出 overlay 中 *精确指名* 的 forceDefer 工具。通配条目（如 `mcp__*`）不在
     * 此返回值里——通配匹配在运行时按工具名查询，无法反向枚举出具体工具集。
     *
     * 用途：ToolSearchTool / DeferExecuteTool 在 queries 模式下需要一次性懒索引
     * 所有被 `Defer(...)` 强制为 defer 的内置工具，否则模型搜不到它们。
     */
    listForceDeferExact(): string[];
    /**
     * 一站式查询：返回 'force-defer' / 'force-no-defer' / undefined。
     *
     * NoDefer 命中优先（即使 Defer 也命中）。已被
     * DeferToolConfigService.isToolDeferLoadingWithOverlay /
     * isBuiltinToolDeferLoading 在最高优先级直接调用。
     */
    decide(toolName: string): 'force-defer' | 'force-no-defer' | undefined;
    private match;
}
