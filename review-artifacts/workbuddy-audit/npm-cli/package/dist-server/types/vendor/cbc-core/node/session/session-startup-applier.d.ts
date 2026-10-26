import { Logger } from '@celljs/core';
import { type SessionStartSource } from '../../../cbc-shared/node/index.js';
import { SessionSettingsHost as SettingsManager, SessionStartupHost } from './session-host-protocol';
import { Session, SessionHookManager, SessionManager } from './session-protocol';
/**
 * 「一个会话刚被建立/续接时，进程要为它做的那些事」。
 *
 * 这些步骤原本内联在 `SessionMiddleWare` 里，因为过去所有会话都由那条 HTTP
 * 准入路径建立。混合模式（`--a2a` + `--input-format stream-json`）打破了这个
 * 前提：A2A 通道可以先到并直接建会话，完全不经过中间件。抽出来是为了让两条
 * 路径共用同一份实现，而不是各写一份然后慢慢漂移——尤其是 auto 权限模式的
 * 可用性门禁，漏掉它意味着 `--permission-mode auto` 能绕过 `disableAutoMode`。
 */
export declare class SessionStartupApplier {
    protected readonly logger: Logger;
    protected readonly sessionManager: SessionManager;
    protected readonly sessionHookManager: SessionHookManager;
    protected readonly settingsManager: SettingsManager;
    protected readonly startupHost: SessionStartupHost;
    /**
     * Process-wide guard: Setup(init) fires exactly once per cbc process
     * (before the first SessionStart), independent of how many sessions the
     * process serves afterwards. Instance field on a singleton component —
     * same process-level semantics as the static it replaced.
     */
    private setupFired;
    /** Test-only reset for the process-level Setup(init) guard. */
    resetSetupGuardForTest(): void;
    emitSessionStartWithPreflight(session: Session, source: SessionStartSource, print: boolean, acp?: boolean): Promise<void>;
    updatePermissionMode(session: Session): Promise<void>;
    /**
     * Gate the `Auto` permission mode through its availability check. When auto is
     * unavailable (e.g. `permissions.disableAutoMode`), downgrade to `Default` —
     * mirrors Claude Code's `kickOutOfAutoIfNeeded`. All other modes pass through
     * unchanged. Centralized here so every entry path (CLI flag, SDK override,
     * preserved upstream mode) is gated consistently.
     */
    private gateAutoMode;
    private resolvePermissionMode;
    private validatePermissionMode;
}
//# sourceMappingURL=session-startup-applier.d.ts.map