import type { Session } from '../../vendor/cbc-core/node/index.js';
import { type ActivePluginRuntimeEntry, Mods, type PluginRuntimeRefreshContext } from '../../vendor/cbc-plugins/node/index.js';
export declare function modsSourceAdmissionFailures(): readonly {
    dir: string;
    reason: string;
}[];
/** Session initialization failures are scoped to the actual owner and current host generation. */
export declare function modsSessionStartupFailures(session: Session): readonly {
    mod: string;
    reason: string;
}[];
/** Read metadata only after engine reconciliation and its public snapshot commit. */
export declare function readFunctionHookMods<T>(read: () => Promise<T>): Promise<T>;
/** Reuse the committed plugin selection; never trigger a recursive plugin refresh. */
export declare function reloadFunctionHookMods(logger?: ModsBootstrapLogger, activePlugins?: readonly ActivePluginRuntimeEntry[], context?: PluginRuntimeRefreshContext): Promise<Mods.BootstrapResult | undefined>;
export declare function closeFunctionHookMods(): Promise<void>;
/** Retire disabled Web code even when no browser session is connected. */
export declare function retireDisabledWebUiFunctionHookMods(logger?: ModsBootstrapLogger): Promise<void>;
/** Filtering revoked installed sources before reconcile retires the old execution instead of retaining it as a failed candidate. */
/**
 * Admission result for a Web Mod before any eligible Web UI session exists. An installed or `--plugin-dir` package's
 * browser half still loads and its host half starts in `ensureWebUiFunctionHookMods` when a Web UI attaches, so the
 * terminal stays quiet about it; the reason remains in Mod diagnostics.
 */
export declare const WEB_MOD_DEFERRED = "Web Mod requires an eligible host with Web UI Mods enabled";
/**
 * Promote already user-enabled, approved authored Mods into this worker once a real Web UI
 * session has attached. It reads the committed PluginManager snapshot and asks for a
 * targeted reload of only the missing or changed authored roots; peers, enable/approval
 * choices and exact-source loading (`loadApprovedMod`) are untouched. Never throws.
 *
 * @returns names of authored Mods that are live with the approved hash afterwards
 */
export declare function ensureWebUiFunctionHookMods(session: Session, logger?: ModsBootstrapLogger): Promise<readonly string[]>;
export declare function modsRuntimeGeneration(): number;
/**
 * 一次 UI 更新的**通用**回调：拿到序列化后的树。
 *
 * 面无关（任何 painter mod 都是同一形状）—— cbc-tui 的 `mods-view` 与 future 出口
 * 都靠订阅这个来拿新一帧。
 */
export type UiPaintListener = (tree: Mods.SerializedElement, plugin: string, sessionId?: string) => void;
export declare function subscribeModsInvalidate(listener: () => void): () => void;
/**
 * 找当前 painter：注册了 `ui.render` 的第一个 mod。
 *
 * 单 painter 是刻意的 —— 多个 mod 同时 render 会互相覆盖，那属于 mod 组合问题，
 * 由官方 `ui.panes`（每个 mod 一个 pane）解决，不该由这一层用 stacking 蒙混。
 */
export declare function getCurrentWebPainter(): string | undefined;
/**
 * 订阅 paint —— cbc-tui `mods-view` 用它监听重绘。
 *
 * @returns 反订阅函数
 */
export declare function subscribeModsPaint(listener: UiPaintListener, surface?: 'terminal' | 'cbc-webui'): () => void;
/** Web UI slot fold 的重拉通知（per-component `ui.render` 通路）。 */
export declare const MOD_RENDER_INVALIDATE_METHOD = "_codebuddy.ai/modRenderInvalidate";
/**
 * 拿一次当前 UI 的**快照**（用于新订阅者的首帧）。
 *
 * 与 `subscribeModsPaint` 是配套的：订阅只拿之后的重绘，首帧要靠一次 snapshot。
 */
export declare function snapshotCurrentUi(surface?: 'terminal' | 'cbc-webui', session?: import('../../vendor/cbc-core/node/index.js').Session): Promise<Mods.SerializedElement | undefined>;
/**
 * 发一次 `ui.press`，闭包按 element key 在共享 RenderRegistry 里查。
 *
 * @param element 元素 key（终端按 hotkey 匹配后取；Web 从按钮 data-key 读）
 * @param surface 面标识 —— 转成官方 `ui.press` 的 surface 字段，mod 能区分是
 *   哪个面点的
 */
export declare function pressCurrentUi(element: string, surface?: string): Promise<{
    deny?: string;
    value?: unknown;
}>;
/**
 * 发一次 `ui.input`，把用户在 `Input` 里输入的（committed）值交给 mod。
 *
 * ## 触发时机由**面**决定
 *
 * WebUI 里是 `<input onBlur>` / 回车 —— 每次 keystroke 都过 ACP 会把远端 mod
 * 打成风暴，因此只在提交时推。TUI 里目前只读展示，不接受终端上的编辑（stdin
 * raw mode 已被 chat InputBox 占用）。
 *
 * @param element 元素 key（Input 的 `key` prop）
 * @param value   用户提交的值（通常是 string，但契约上允许 unknown）
 * @param surface 面标识（`'cbc-webui'` / `'terminal'`）
 */
export declare function inputCurrentUi(element: string, value: unknown, surface?: string, kind?: 'change' | 'submit'): Promise<{
    deny?: string;
    value?: unknown;
}>;
/**
 * 发一次 `ui.select`：mod 画的 `Select` 里用户选中的值。
 *
 * Select 变更即 committed（不像 Input 需要 blur），所以 webui 端 `<select onChange>`
 * 就直接推。
 */
export declare function selectCurrentUi(element: string, value: unknown, surface?: string): Promise<{
    deny?: string;
    value?: unknown;
}>;
/**
 * 发一次 `ui.focus`。mod 用它做「聚焦时揭示、失焦重掩」这类交互（issue-91870
 * 的 hide-until-hover fixture 就是这个形状）。
 *
 * @param focus true = 聚焦，false = 失焦
 */
export declare function focusCurrentUi(element: string, focus: boolean, surface?: string): Promise<{
    deny?: string;
    value?: unknown;
}>;
/**
 * 发一次 `ui.scroll`。为了对齐官方事件表，先暴露通道；webui 端目前不接容器
 * `onScroll`（频率极高、需要节流），mod pane 化后再接。
 */
export declare function scrollCurrentUi(element: string, delta: number, surface?: string): Promise<{
    deny?: string;
    value?: unknown;
}>;
/**
 * 远端面要某个 `Client` 的 surface module 代码（官方 `ui_client_module`）。
 *
 * plugin 必须是已装载的 mod；路径越界、文件缺失、编译失败一律 `{ deny }`。
 */
export declare function clientModuleOf(plugin: string, module: string): Promise<{
    code?: string;
    deny?: string;
}>;
/**
 * Official `ui.fault`: a `Client` this plugin drew failed on a surface (`phase`:
 * its module did not load, its drawing failed, or its code failed after it drew).
 * Only that plugin's hooks see it; core answers `{}`.
 */
export declare function faultCurrentUi(args: {
    plugin: string;
    element: string;
    module: string;
    phase: 'load' | 'render' | 'run';
    reason: string;
    component?: string;
    requestId?: string;
    surface?: string;
}): Promise<void>;
/**
 * 一个 `Client` 实例的 `surface.post(data)` 回到它所属 plugin 的 hooks：
 * 官方 `ui.message`，只有画它的 plugin 能看见；hook 回 `{ props }` 即该实例
 * 的下一份 props（不跑 `ui.render`）。
 */
export declare function messageCurrentUi(args: {
    plugin: string;
    element: string;
    module: string;
    data: unknown;
    component?: string;
    requestId?: string;
    surface?: string;
}): Promise<{
    props?: unknown;
    deny?: string;
}>;
/** Shared hotkey lookup for the TUI pane and its input's disabledShortcuts. */
export declare function currentUiHotkey(hotkey: string): string | undefined;
/** 当前是否有 painter mod 挂载 —— CLI dispatcher 据此决定要不要跳 `/mods`。 */
export declare function hasPainterMod(): boolean;
/** 一个最小的日志出口（用 cli-dispatcher 的 logger 注入）。 */
export interface ModsBootstrapLogger {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
}
/**
 * 汇总本次要加载 mod 的目录：`--plugin-dir` + 已装 plugin（user/project scope）。
 *
 * ## 为什么两条来源合并
 *
 * mod 是**插件的一种**，不是独立通道 —— 用户装了带 `hooks/hooks.json` 的 plugin
 * 就应该自动生效，无需每次都 `--plugin-dir` 指路；同时开发/测试仍要 `--plugin-dir`
 * 立即加载。两者叠加即可。
 *
 * ## 顺序：`--plugin-dir` 在前
 *
 * mods loader 按注册序决定同 tier 内的外层/内层。CLI 明说要用的排在前面 ——
 * 开发者一句 `--plugin-dir` 可以外包住已装 plugin 的行为，观察 / 改写 / 拦截，
 * 而不必卸载再装。
 *
 * ## 已装 plugin 从 pluginManager 拿，不扫盘
 *
 * `pluginManager.listPlugins()` 是权威来源 —— 它已经把 `installed_plugins.json`
 * 与 scope 匹配、依赖闭包 verify、marketplace verify 都做完了。扫盘会绕过这些
 * 保证，还会捡到被卸载 / 禁用后遗留的目录。
 *
 * ## 先等 refresh settled
 *
 * `pluginManager.listPlugins()` 在 refresh 完成前返回可能是空/半成品。等一次
 * `waitForRefreshSettled()` 确保拿到的是最终态。DI 里没有 refresh service（新起
 * 的 subcommand / test）就跳过等，退化到「只从 pluginManager 直接问一次」——
 * 也可能拿到旧值，但那不比等到永远差。
 */
/** @internal 供 mods-bootstrap.spec.ts 直接断言这一步的合并/去重语义，避免要 mock Mods.bootstrapModsFromPluginDirs 才能间接观察。 */
export declare function collectModDirs(logger?: ModsBootstrapLogger): Promise<string[]>;
/** Manifest declares a browser `client` half: a complete Mod even without host hooks. */
export declare function isBrowserOnlyPackage(dir: string): Promise<boolean>;
/**
 * 同 {@link collectModDirs}，但同时报告每条目录的**来源**：`--plugin-dir` 显式
 * 指定的，还是从已装 plugin 里扫来的。
 *
 * ## 为什么要区分
 *
 * mods loader 会对**任何**不是有效 mod 的目录发 `skipped` 报告（缺 hooks.json /
 * 缺 modules 声明 / …）。
 *
 * - `--plugin-dir` 是用户**显式**要求加载的目录：加载不上必须让用户看见，否则
 *   他们无从知道为什么 mod 没生效。
 * - 已装 plugin 大多数**根本不是 mod**（普通 skill / connector / agent 包），扫
 *   过去 skipped 是常态、不是异常。默认路径把它们逐条打印到 stderr 只会污染
 *   用户视野。
 *
 * bootstrapFunctionHookMods 用这个来过滤 `skipped` 日志：只报 --plugin-dir 显式
 * 目录的 skip，其余按 `NODE_ENV=development` 决定是否透出。
 */
export declare function collectModDirsWithSources(logger?: ModsBootstrapLogger): Promise<{
    /** 合并去重后的完整目录列表（与 collectModDirs 语义一致）。 */
    readonly all: string[];
    /** `--plugin-dir` 显式给的目录 —— skipped 时必须让用户看见。 */
    readonly explicit: ReadonlySet<string>;
}>;
/**
 * agent-cli 这一侧的宿主能力绑定。
 *
 * 只填 mods 的 `core` 层真正问得到的那些项；没填的能力会被明确拒绝（而不是静默
 * 返回 undefined），mod 因此能当场退化 —— 官方 mod 就是按这个前提写的。
 *
 * ## 为什么 `log` 走 bridge 而不是 stderr
 *
 * 官方 `$.ui.log` 的语义是「进 transcript」——用户可见的会话历史，与用户/助手
 * 消息并列。所以宿主要把这一行推进当前 session 的 `inputSubject` /
 * `combineSubject` / `sessionStore.appendHistory`（TUI 增量渲染 + ACP 广播 +
 * 磁盘 transcript 一次到位），走 `currentModsBridge().pushModLog(...)` 是最短路径。
 *
 * 前缀由这里加：`<plugin>: <text>`。core 层只是搬运 `origin.plugin`，不加前缀；
 * SessionManager 也不加。**只有一个前缀出口**，这样：mod 侧看到 `$.ui.log(text)`
 * 与自己写的字符串一致（不被夹带），宿主侧渲染就直接带归属，前端不用再拼。
 *
 * ### 兜底通道（三条）
 *
 * 1. `to === 'debug'` → 直接走 logger，不进 chat（官方语义：debug 通道属于诊断，
 *    不应污染用户对话）
 * 2. bridge 未装（bootstrap 早期 / headless 没有 chat view）→ stderr
 * 3. bridge 装了但当前无 session（prewarm standby / getCurrent() 抛错）→ 由 bridge
 *    实现内部再兜一次 stderr
 */
/** @internal 供 mods-bootstrap.spec.ts 直接断言 `log` 前缀与 bridge 分发路径。 */
export declare function hostBindings(logger?: ModsBootstrapLogger): Mods.HostBindings & {
    dispose(): Promise<void>;
};
/**
 * 按 `CODEBUDDY_PLUGIN_DIRS` 启动 mods 运行时。
 *
 * ## 绝不阻塞启动
 *
 * 这一步位于 CLI 启动链上，**任何情况下都不向外抛**。plugin 加载失败只做
 * 「错误感知」：把原因写进日志、记在诊断里，然后让 CLI 照常往下走。
 *
 * 分层兜底：
 * - 单个目录读不出 / TS 加载失败 → `skipped`，其余目录照常
 * - 单个 mod `register()` 抛错、`engine.create` 违规 → `failures`，其余 mod 照常
 * - 连 host 的 fold 都失败 → 退化成「没有 mods 能力」
 * - 本函数自身任何未预料异常 → 就地咽下并记日志
 *
 * 只在启动链上调用一次；重复调用直接返回已有的那份。
 *
 * @param logger 日志出口（失败要让用户看见，但不能打断流程）
 * @returns 运行时；开关未开、没有 `--plugin-dir`、或整体失败时 undefined
 */
export declare function bootstrapFunctionHookMods(logger?: ModsBootstrapLogger): Promise<Mods.BootstrapResult | undefined>;
/** 当前 mods 运行时（未启动时 undefined）。 */
export declare function currentModsRuntime(): Mods.BootstrapResult | undefined;
/**
 * Per-component `ui.render` cap —— 哪些 `RenderComponent` 值有 mod 挂了 hook。
 *
 * 让 slot 组件（尤其是 Web UI 的 slot 通过 ACP round-trip）**在发 request 前先查**：
 * 未命中的组件根本不 dispatch，零网络、零 setState、零重画。
 *
 * ## 返回形态
 *
 * - `undefined`：mod runtime 未装（`--plugin-dir` / installed mods 都没）—— slot
 *   全部走默认 React JSX，最保守也最正确
 * - `'all'`：至少有一条 `on('ui.render', hook)` 无 matcher（或 matcher 未约束
 *   `component`）—— 通配，所有 slot 都得发 dispatch
 * - `ReadonlySet<string>`：精确 matcher 集合 —— slot 只在 component 命中时才发
 *   （集合可能为空 = "有 mod runtime，但没人写 `ui.render` hook"，slot 全部跳过）
 *
 * 供 acp-agent 侧的 `broadcastModRenderCap` 与 TUI slot 的 `useModRenderFold` 共用。
 */
export declare function currentUiRenderCap(): 'all' | ReadonlySet<string> | undefined;
/** 仅测试用：装一份已启动的 runtime（不走 CLI 启动链）。 */
export declare function installModsRuntimeForTests(result: Mods.BootstrapResult): void;
/** 仅测试用：清掉进程级单例。 */
export declare function resetModsRuntimeForTests(): void;
export declare function installModPaintAcpBridge(broadcast: (frame: {
    readonly plugin: string;
    readonly tree: Mods.SerializedElement;
    readonly sessionId?: string;
}) => void): () => void;
/** Web UI slot snapshot notification (AbovePrompt band + shown Pane + toasts). */
export declare const MOD_SLOTS_METHOD = "_codebuddy.ai/modSlots";
