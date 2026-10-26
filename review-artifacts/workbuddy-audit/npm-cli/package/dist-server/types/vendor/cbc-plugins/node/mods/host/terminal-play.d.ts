import type { HookFailureReporter } from '../engine/hooks-registry';
import type { ModsRuntime } from '../engine/mods-runtime';
import type { HostBindings } from './host-bindings';
/**
 * 终端里让 UI mod **真的能看见并交互**。
 *
 * ## 为什么是独立入口，不接进主 TUI
 *
 * 主 TUI 是 Ink 组件树，接进去要动 App 架构、focus 管理、样式主题。给 mod 单开
 * 一个入口能最短路径把 Phase 4 剩下的两块 —— 宿主 paint 出口 + 键盘回流 —— 落
 * 实到位，且不会误伤既有 chat UI。这一层刻意只做**面**的活：拿到序列化树 →
 * 画到屏上；抓到按键 → 转成 `ui.press`。游戏逻辑与画树都在 mod 里。
 *
 * ## 为什么不 await 每一次画
 *
 * 一拍的重力（`clock.every`）里既要推状态又要请求重绘，画得多慢是**面**的事
 * —— 慢面不该拖慢游戏节奏。因此 `paint` 出口是 fire-and-forget，重绘请求
 * (`invalidate`) 也只是把一次待处理标记起来，多次请求聚合成一次画。
 *
 * ## Ctrl+C / q 退出，也告诉 mod 会话要结束
 *
 * 退出前 dispatch `session.end`，让 mod 有机会 flush（内置 `telemetry` mod 就靠
 * 它落盘计数）。否则最后一局的埋点全丢，且用户看不到「保存了」这类反馈。
 */
/** 一次终端 paint 会话的可选项。 */
export interface TerminalPlayOptions {
    /** 输出流；默认 `process.stdout`。 */
    readonly stdout?: NodeJS.WriteStream;
    /** 输入流；默认 `process.stdin`。 */
    readonly stdin?: NodeJS.ReadStream;
    /**
     * 宿主自己想附加的绑定（`cwd` / `root` / `storeDir` / `settings` …）。
     * `paint` / `invalidate` / `log` / `status` / `toast` 会被本模块覆盖 ——
     * 那几项才是让 mod 在终端上「亮起来」的具体实现。
     */
    readonly extraBindings?: HostBindings;
    /** hook 运行期失败上报（默认写 stderr）。 */
    readonly onHookFailure?: HookFailureReporter;
}
/** 终端 paint 会话的门面，供调用方停止。 */
export interface TerminalPlaySession {
    /** 停止并回收（还原 stdin 模式、清屏、卸载 SIGINT）。 */
    stop(): Promise<void>;
    /** 显式发一次重绘请求（外部逻辑改了状态时用）。 */
    invalidate(): void;
}
/**
 * 用**运行时对象**建一个终端 paint 会话。
 *
 * 与 `bootstrapModsFromPluginDirs` 是配套的：先启动 runtime、再传进来。
 *
 * @param runtime 已 `start()` 完成的运行时
 * @param options 输出/输入流 / 附加绑定
 * @returns 会话门面；调用 `stop()` 收尾
 */
export declare function playModsInTerminal(runtime: ModsRuntime, options?: TerminalPlayOptions): TerminalPlaySession;
//# sourceMappingURL=terminal-play.d.ts.map