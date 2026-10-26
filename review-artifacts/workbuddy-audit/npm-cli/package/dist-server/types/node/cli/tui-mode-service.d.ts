export declare const TuiModeService: unique symbol;
export interface ITuiModeService {
    /**
     * 当前 CLI 进程是否处于交互式 TUI 模式。
     *
     * 判据与 `DefaultModeStrategy` 里的 `isInteractive`（cli/strategies/default-mode-strategy.ts:111）
     * 保持一致：`process.stdout.isTTY && !--print && !--input-format=stream-json &&
     * !--output-format=stream-json && HEADLESS!==true`。
     *
     * 直接live-read `process.argv` —— 与 mcp-ready-service 的 `isHeadless()` 同款做法：
     * prewarm activate 时 `applyPrewarmArgs` 会重写 process.argv 剔除 --prewarm 并注入
     * 真实业务 flag，之后再读天然拿到最新值。禁止在构造函数 / @PostConstruct 里
     * cache 结果（会latch 冷启动空argv，见 CODEBUDDY.md §"env 消费同理"章节的同款
     * 陷阱）。
     */
    isTuiMode(): boolean;
}
export declare class TuiModeServiceImpl implements ITuiModeService {
    isTuiMode(): boolean;
}
