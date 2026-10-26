/**
 * Tool Spec 解析层契约。
 *
 * 「Tool Spec」是用户在 *工具列表* 字段里写的单条字符串，例如：
 *   - `Read`                       // 普通工具
 *   - `mcp__github__create_pr`     // MCP 工具
 *   - `mcp__github__*`             // 通配
 *   - `Defer(Glob)`                // 强制让 Glob 在该会话变成 defer 工具
 *   - `NoDefer(Bash)`              // 强制让 Bash 在该会话变成非 defer 工具
 *
 * 该层 *只* 负责把一组字符串切分为
 *   1) 纯工具名/通配数组（`names`），喂给现有可见性逻辑；
 *   2) 会话级 defer overlay 快照（`overlay`），喂给 `DeferToolConfigService`。
 *
 * 它 *不* 做：
 *   - 工具是否存在的校验（运行时再校验）；
 *   - 权限语法（`Read(*.md)`）的解析（属于权限层）；
 *   - 通配匹配本身（由 `ToolDeferOverlay` 封装）。
 *
 * 渠道边界：`Defer(...)` / `NoDefer(...)` *仅* 在工具列表字段（`--tools`、agent
 * frontmatter `tools:`、product `agents[].tools`）有效。权限规则字段必须由权限层
 * 自行拒绝这两个前缀，避免两套 DSL 互嵌。
 */
import type { ToolDeferOverlaySnapshot } from '../../../vendor/cbc-shared/node/index.js';
/**
 * Defer 修饰前缀。
 */
export type DeferModifier = 'Defer' | 'NoDefer';
/**
 * 单条 spec 解析结果。
 */
export interface ParsedToolSpec {
    /** 工具名或通配模式（如 "Read"、"mcp__github__*"），已剥离修饰符。 */
    pattern: string;
    /** defer 修饰；undefined 表示该 spec 未指定修饰，由全局默认决定。 */
    modifier?: DeferModifier;
    /** 是否含通配（仅 `*` 视作通配元字符）。 */
    isGlob: boolean;
    /** 原始字符串，便于报错与审计定位。 */
    raw: string;
}
/**
 * defer overlay 的纯数据快照。`ToolDeferOverlay` 基于此构造可查询对象。
 *
 * 之所以拆 `exact` / `glob` 两桶：
 *   - exact 用 Set，O(1) 查询；
 *   - glob 走线性扫描 + 锚定 RegExp，数量通常 <10，开销可忽略。
 */
export type { ToolDeferOverlaySnapshot } from '../../../vendor/cbc-shared/node/index.js';
/**
 * 一组 spec 批量解析的产物。
 */
export interface ParsedToolSpecs {
    /**
     * 剥离 defer 修饰后的纯工具名/通配，按首次出现顺序去重。
     * 直接喂给现有可见性 / 白名单 / 黑名单逻辑，不需要再感知 defer 修饰。
     */
    names: string[];
    /** 会话级 defer overlay 快照。 */
    overlay: ToolDeferOverlaySnapshot;
    /** 解析过程中的非阻断警告（如重复条目、修饰符冲突）。 */
    warnings: ToolSpecWarning[];
}
/**
 * 非阻断警告。调用方按需上报到 telemetry / 控制台。
 */
export interface ToolSpecWarning {
    code: 'duplicate-spec' | 'conflicting-modifier' | 'invalid-pattern';
    message: string;
    raw: string;
}
/**
 * 解析期严重错误。
 *
 * 默认 `parseToolSpecs` 抛出此错误；调用方传 `{ lenient: true }` 时，错误会被
 * 转换成 `invalid-pattern` warning 并丢弃当前 spec（用于兼容老版本 CLI 解析
 * 含 `Defer(...)` 修饰的 product 配置）。
 */
export declare class ToolSpecParseError extends Error {
    readonly raw: string;
    readonly reason: string;
    constructor(raw: string, reason: string);
}
