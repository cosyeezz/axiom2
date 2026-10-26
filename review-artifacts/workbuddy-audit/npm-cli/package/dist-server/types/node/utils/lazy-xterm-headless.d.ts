/**
 * @xterm/headless 真·惰性装载：主 chunk 139 KB → lazy chunk。
 *
 * ## Standby 期不加载
 *
 * xterm Terminal 只用于：
 *   - `shell/shell-service.ts` — PTY 输出解析，只在 tool bash execute 走
 *   - `sandbox-cli/sandbox-execution-handle.ts` — sandbox 命令执行的 terminal 状态
 *
 * standby 期无 shell / sandbox 命令，`new Terminal()` 从未触发。
 */
type XtermHeadlessModule = typeof import('@xterm/headless');
export declare function preloadXtermHeadless(): Promise<XtermHeadlessModule>;
export declare function getXtermHeadless(): XtermHeadlessModule;
export {};
