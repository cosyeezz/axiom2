import { Logger } from '@celljs/core';
import { type BashSandboxManager as IBashSandboxManager } from '../bash-sandbox/bash-sandbox-protocol';
import { type ShellExecuteParams, type ShellExecutionHandle, type ShellService } from './shell-protocol';
/**
 * Platform-dependent sandbox backend dispatch.
 *
 *   - `sandbox-cli`: the persistent Rust binary + IPC
 *   - `off`:         local execution, no sandbox
 */
export type SandboxBackend = 'sandbox-cli' | 'off';
/**
 * 委托 Shell 服务
 *
 * 注册在 ShellService Symbol 上，替代原来的 ShellServiceImpl 作为默认实现。
 * 根据 `settings.sandbox.enabled` + 平台 决定委托给哪个后端：
 *   - sandbox 开启 → SandboxShellService (sandbox-cli)
 *   - 其他情况     → LocalShellService
 */
export declare class DelegatingShellService implements ShellService {
    protected readonly localShellService: ShellService;
    protected readonly sandboxShellService?: ShellService;
    protected readonly bashSandboxManager?: IBashSandboxManager;
    protected readonly driverShellService: ShellService;
    protected readonly logger: Logger;
    execute(params: ShellExecuteParams): Promise<ShellExecutionHandle>;
    disposeAll(): Promise<void>;
    getActiveHandleCount(): number;
    /**
     * Resolve the sandbox backend for the current process.
     *
     * Single source of truth for the enable/disable decision is
     * `settings.sandbox.enabled` (same file the TUI `/sandbox` panel and the
     * Desktop SandboxConfigBar write); `getConfig()` already folds in platform
     * support, so an enabled config always means `sandbox-cli`.
     */
    resolveBackend(): Promise<SandboxBackend>;
    private pickDelegate;
}
