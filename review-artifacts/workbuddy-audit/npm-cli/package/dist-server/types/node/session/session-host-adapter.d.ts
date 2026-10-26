import { type Session, SessionConsoleHost, SessionRequestContextHost, SessionSettingsHost, type SessionSettingsValues, SessionStartupHost, SessionUsageHost } from '../../vendor/cbc-core/node/index.js';
import { ConsoleManager } from '../console';
import { DirectoryTrustService } from '../permission';
import { SettingsManager } from '../settings';
import { UserStateManager } from '../tips';
import { AutoModePermissionService } from '../tools/auto-mode/auto-mode-protocol';
export declare class SessionSettingsHostAdapter implements SessionSettingsHost {
    protected readonly settings: SettingsManager;
    get<K extends keyof SessionSettingsValues>(key: K): Promise<SessionSettingsValues[K]>;
    getStartupModel(): Promise<string | undefined>;
}
export declare class SessionUsageHostAdapter implements SessionUsageHost {
    protected readonly usage?: UserStateManager;
    incrementSession(): Promise<void>;
    incrementPromptQueue(): Promise<void>;
}
export declare class SessionConsoleHostAdapter implements SessionConsoleHost {
    protected readonly console: ConsoleManager;
    error(...args: unknown[]): void;
}
export declare class SessionRequestContextHostAdapter implements SessionRequestContextHost {
    get(): Session | undefined;
    set(session: Session): void;
}
export declare class SessionStartupHostAdapter implements SessionStartupHost {
    protected readonly trust: DirectoryTrustService;
    protected readonly autoMode: AutoModePermissionService;
    protected readonly settingsManager: SettingsManager;
    waitForPluginRefresh(): Promise<void>;
    waitForDirectoryTrust(): Promise<void>;
    isAutoModeAvailable(): Promise<{
        available: boolean;
    }>;
    isSettingsAutoGrantAllowed(): Promise<boolean>;
    /**
     * settings 层的 fullAccess 只认 USER / CLI scope 来源：project / project-local
     * 可能来自 checked-in 仓库配置，不能自授宿主级免审批执行；远程经网关写入
     * 的用户默认已由 `local-settings-controller` 的来源闸门拦截。
     */
    isSettingsUnrestrictedModeGrantAllowed(): Promise<boolean>;
}
