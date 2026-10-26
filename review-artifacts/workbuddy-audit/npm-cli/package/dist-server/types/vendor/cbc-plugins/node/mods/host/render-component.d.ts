/**
 * Per-component `ui.render` fold 的类型契约 —— 对齐 Anthropic `claude-code`
 * 官方 `RenderComponent` 语义（`mods/types/claude-code.d.ts`）。
 *
 * ## 语义模型
 *
 * `on('ui.render', { component: 'ToolUse' }, ($, e, next) => {
 *     const beneath = await next(e)                 // core 返回的 SENTINEL 树
 *     return { ...beneath, tree: <Box>{beneath.tree}<Badge/></Box> }
 * })`
 *
 * 三种典型行为都走同一分派链：
 *
 * | Mod 写法                              | Slot 侧行为                               |
 * |---------------------------------------|-------------------------------------------|
 * | `return next(e)`                      | SENTINEL 原样返回 → 走真实 React JSX      |
 * | `return { tree: <Own/> }`             | 完全覆盖 → paint(Own) 到面上              |
 * | `return { tree: <Box>{beneath}</Box>}`| 装饰 → paint 的子树里 SENTINEL 回落 React |
 *
 * ## 为什么 Slot 组件不预先 serialize
 *
 * 15 个 slot 里有 streaming（`AssistantMessage`）、xterm widget（`CommandOutput`）、
 * word-level diff（`ToolResult`）等**无法用闭合标签集完整表达**的能力。若强行 serialize
 * 会丢失体验。走 SENTINEL 的关键在于：**默认路径永远是 React JSX**，只有 mod 主动
 * 改写才走 paint —— 未装 mod / mod 未干预时零成本、零行为差。
 *
 * ## 与 `Pane` 通路的关系
 *
 * `Pane` 也在联合类型里，因此 `on('ui.render', { component: 'Pane' }, ...)` 会匹配
 * `component: 'Pane'` 的 dispatch。**但**当前旧 `mods-render-panel` 通路走的是"无
 * `component` 字段的通用 `ui.render`"（core-handler 缺 `component` 时返回 `{}`），
 * 二者共存 —— 迁移期后再收敛到单一 slot 分派。
 */
import type { SerializedElement } from './render-registry';
/**
 * 受 mod 侧 `on('ui.render', { component: 'X' }, ...)` 分派的所有内置 slot。
 *
 * 每个字面量都对应 TUI + Web UI 上一个具体 React 组件位置，见 plan file 的对照表。
 * 新增 slot 前先在 15 个之外补一行、并在**两个** surface 上同步落地 wrap，避免
 * mod 作者以为可以 `on('ui.render', { component: 'X' }, ...)` 而实际 X 只在一面 wrap 了。
 */
export type RenderComponent = 'AskUserQuestion' | 'UserMessage' | 'AssistantMessage' | 'ToolUse' | 'ToolResult' | 'ToolGroup' | 'ToolProgress' | 'CommandOutput' | 'Spinner' | 'TurnDuration' | 'InfoNotice' | 'SessionMode' | 'PromptHint' | 'AbovePrompt' | 'Pane';
/** `ui.render` 事件的输入 payload —— slot 组件 dispatch 时构造。 */
export interface UiRenderInput {
    /**
     * 内置 slot 分派 discriminant。**不传** = 通用 `ui.render`（旧 Pane 通路 /
     * `mods-render-panel` 走这条），mod 侧 `on('ui.render', hook)` 无 matcher 时
     * 通配匹配。
     */
    readonly component?: RenderComponent;
    /**
     * 当前渲染面。**必填**：mod 通过 `$.ui.resolve(e)` 拿 surface 特定的 element table
     * （官方 `Elements[E['surface']]`），据此对同一逻辑树做面差异化产物。
     */
    readonly surface: RenderSurfaceLoose;
    /**
     * slot 具体 props —— TypeScript index signature 兼容任意读法，避免 mod 作者
     * 对 slot 的实际 props 形状做假设时被编译器挡住；运行时按 host 实际注入为准。
     */
    readonly [key: string]: unknown;
}
/**
 * `ui.render` 事件的返回值形状 —— mod hook 返回、slot 组件消费。
 *
 * `tree` 是**唯一被 slot 消费的字段**；其它字段允许 mod 之间约定，走 index signature。
 */
export interface UiRenderResult {
    readonly tree?: SerializedElement;
    readonly [key: string]: unknown;
}
/**
 * SENTINEL 元素类型名。
 *
 * Core-handler 处理 `ui.render` 且 `input.component` 有值时，返回：
 *
 * ```
 * { tree: { type: 'Default', props: { component: 'ToolUse' }, children: [] } }
 * ```
 *
 * 面上的 paint helper 遇到 `type === 'Default'` 时，**回落到 slot 传入的
 * `defaults[props.component]()`** —— 也就是真实的默认 React 组件。这一步是"允许
 * 完整覆盖 + 保留 streaming/动画"两个目标的接合点。
 */
export declare const SENTINEL_ELEMENT_TYPE: 'Default';
/**
 * 构造一个 SENTINEL 元素 —— 只有 core-handler 应当调用。
 *
 * @param component 该 slot 的类型（用于 paint 回落时按 component 查真实组件）
 */
export declare function makeSentinelElement(component: RenderComponent): SerializedElement;
/**
 * 判断一颗树是不是 core 返回的原始 SENTINEL —— slot 组件据此走"真实 React JSX"路径。
 *
 * @param tree 待检查的树；`undefined` 视为 SENTINEL 等价（mod 完全没干预）
 * @param component 可选：只有当 `tree.props.component` 匹配时才判 true。
 *   不传即接受任意 SENTINEL —— 对通配 hook 有意义
 */
export declare function isSentinelTree(tree: SerializedElement | undefined, component?: RenderComponent): boolean;
/**
 * 判断一个元素**节点**（非整棵树）是不是 SENTINEL —— paint helper 在递归时用它
 * 决定是否回落到 `defaults[component]()`。
 */
export declare function isSentinelElement(node: SerializedElement): node is SerializedElement & {
    props: {
        component: RenderComponent;
    };
};
/**
 * `RenderSurface` 的宽松版本 —— 供 `UiRenderInput.surface` 使用。
 *
 * 这里刻意不 import `host-bindings.ts:RenderSurface`：那份类型是**宿主的能力面
 * 契约**（`session.start` 里的 surface enum），演进节奏与 mod API 不完全同步
 * （host 支持 `mobile` 但当前 UI 尚未落地）。此处允许字符串扩展，保持前向兼容。
 */
export type RenderSurfaceLoose = string;
//# sourceMappingURL=render-component.d.ts.map