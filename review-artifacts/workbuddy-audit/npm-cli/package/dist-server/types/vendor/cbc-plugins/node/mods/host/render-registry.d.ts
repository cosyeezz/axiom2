import type { Origin } from '../types';
/**
 * 渲染树的跨面传输：**树序列化出去，交互按 key 回来**。
 *
 * ## 为什么必须这样做
 *
 * `$.ui.*` 不是终端专用 —— 官方 `RenderSurface` 就是
 * `'terminal' | 'desktop' | 'mobile' | 'vscode'`，`$.session.surfaces()` 还返回
 * 复数。终端在本进程里画，而 desktop / web / vscode 在**另一个进程**里画，中间
 * 只有一条可序列化的通道（cbc 这边是 ACP 的 `extNotification` / `extMethod`）。
 *
 * 于是产生一个看似矛盾的约束：`Button` 的 props 里有 `onPress: () => void`，
 * 闭包不可能过线。官方的解法不是禁掉闭包，而是**让闭包留在 agent 侧**：
 *
 * 1. hook 在 agent 进程里渲染出树；
 * 2. 序列化时把函数型 prop 摘下来，按元素的 `key` 存进一张表，树上只留 `key`；
 * 3. 纯数据的树送到 surface；
 * 4. surface 上按下按钮，回传 `{ plugin, element: key, surface }`；
 * 5. 引擎按 `plugin + key` 找回闭包，**在它自己的 plugin 环境里**执行。
 *
 * 所以 JSX 完全可用 —— 它只是写法，编译后是数据树，闭包从不离开本进程。
 *
 * ## 为什么按 `plugin` 分表
 *
 * `key` 是 mod 自己起的名字（`ButtonProps.key` 默认取 label），两个 mod 同时画
 * 一个 `确定` 按钮几乎必然撞。不按 plugin 隔离的话，一次点击会跑到别人的闭包
 * 上 —— 而且这种串台在界面上看起来「按钮没反应」或「按错了」，极难归因。
 */
/**
 * 官方元素表的全部 tag —— 这是一个**闭集**。
 *
 * 校验它而不是放行任意字符串：一个写错 tag 的 mod（JSX 里手滑写成 `<div>`）
 * 若被放行，垃圾会一路送到 surface，而 surface 只能默默丢弃或者崩 —— 报错点离
 * 错误源隔着一个进程边界，极难归因。在序列化这一层挡住，错误就停在写错的那个
 * mod 身上。
 *
 * `Client` / `Raster` / `Image` 并非每个面都支持（官方
 * `ClientElements = Omit<Elements['terminal'], 'Client' | 'Raster' | 'Image'>`），
 * 但那是**面能力**的判断，属于宿主 paint 出口该做的事；这里只管 tag 是否存在。
 */
export declare const RENDER_TAGS: ReadonlySet<string>;
/** 一棵序列化后的渲染树：纯数据，可安全跨进程。 */
export interface SerializedElement {
    readonly type: string;
    readonly props: Readonly<Record<string, unknown>>;
    readonly children: readonly SerializedElement[];
}
/**
 * 一个 plugin 可以同时在多处画（输入框上方的 band、一个或多个 Pane、旧 painter 面板）。
 * 每处是一个 scope：重绘只整表替换**本 scope** 的闭包，不会把另一处仍在屏幕上的按钮作废。
 */
export declare const DEFAULT_RENDER_SCOPE = "default";
/**
 * 渲染树的交互闭包表 —— 一个 plugin 一张。
 *
 * 每次重绘**整表替换**该 plugin 的条目：旧树上的按钮已经不在界面上了，留着它的
 * 闭包只会让一次迟到的点击跑到上一帧的逻辑上。
 */
export declare class RenderRegistry {
    private readonly handlers;
    private readonly hotkeys;
    /**
     * 序列化一棵树，同时登记它的交互闭包。
     *
     * @param plugin 画这棵树的 mod
     * @param tree hook 返回的渲染树（JSX 编译结果即是此形状）
     * @param scope 这棵树画在哪（band / 某个 Pane / 旧 painter 面板）
     * @returns 纯数据的树，可直接过线
     */
    serialize(plugin: string, tree: unknown, scope?: string): SerializedElement | undefined;
    private scopesOf;
    private walk;
    /**
     * 跑回某个元素的交互闭包。
     *
     * @param event op 事件名（`ui.press` / `ui.input`）
     * @param plugin 该元素属于哪个 mod
     * @param element 元素 key
     * @param args 传给闭包的实参（`onInput` 会带值）
     * @returns 闭包的返回值；没有登记过则 `undefined`
     */
    invoke(event: string, plugin: string, element: string, ...args: readonly unknown[]): Promise<{
        ran: boolean;
        value?: unknown;
    }>;
    /**
     * 只在某一处（scope）画的树里跑闭包：同一个 key 在 band / Pane / 不同面上各有一帧，
     * 闭包捕获的是**那一帧**的状态（例如翻页按钮绑定的当前步数），不能串到别处的帧上。
     */
    invokeIn(scope: string, event: string, plugin: string, element: string, ...args: readonly unknown[]): Promise<{
        ran: boolean;
        value?: unknown;
    }>;
    /**
     * 按 hotkey 找当前树上的元素 key。
     *
     * 供**面**用（终端的 keypress、Web 的键盘转 press）：拿到用户按的键 →
     * 找到匹配的 Button → dispatch `ui.press`。找不到返回 undefined（那就是
     * 一个和当前界面无关的按键，安静地忽略）。
     *
     * @param plugin 画这棵树的 mod
     * @param hotkey 按下的键（原样，如 `'a'` / `'\r'`）
     * @param scope 只在这一处画的树里找
     */
    findHotkey(plugin: string, hotkey: string, scope?: string): string | undefined;
    /** 丢弃某个 mod 的全部闭包（它被卸载时）。 */
    forget(plugin: string): void;
    clear(): void;
    /** 当前登记了多少个可交互元素（诊断用）。 */
    countOf(plugin: string): number;
}
/** 从 `ui.press` / `ui.input` 的入参里取出寻址信息。 */
export declare function addressOf(input: Record<string, unknown>, origin: Origin): {
    plugin: string;
    element: string;
};
//# sourceMappingURL=render-registry.d.ts.map