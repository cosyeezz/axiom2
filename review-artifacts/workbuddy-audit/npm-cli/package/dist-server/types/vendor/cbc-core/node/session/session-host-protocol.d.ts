import type { Session } from './session-protocol';
export declare const SessionSettingsHost: unique symbol;
export interface SessionSettingsValues {
    model?: string;
    outputStyle?: string;
    showTurnDuration?: boolean;
    permissions?: {
        defaultMode?: string;
    };
}
export interface SessionSettingsHost {
    get<K extends keyof SessionSettingsValues>(key: K): Promise<SessionSettingsValues[K]>;
    getStartupModel(): Promise<string | undefined>;
}
export declare const SessionUsageHost: unique symbol;
export interface SessionUsageHost {
    incrementSession(): Promise<void>;
    incrementPromptQueue(): Promise<void>;
}
export declare const SessionConsoleHost: unique symbol;
export interface SessionConsoleHost {
    error(...args: unknown[]): void;
}
export declare const SessionRequestContextHost: unique symbol;
export interface SessionRequestContextHost {
    get(): Session | undefined;
    set(session: Session): void;
}
export declare const SessionStartupHost: unique symbol;
export interface SessionStartupHost {
    waitForPluginRefresh(): Promise<void>;
    waitForDirectoryTrust(): Promise<void>;
    isAutoModeAvailable(): Promise<{
        available: boolean;
    }>;
    isSettingsAutoGrantAllowed(): Promise<boolean>;
    /**
     * settings 层的免审批权限模式（如 fullAccess）是否可被信任。
     *
     * 与 `isSettingsAutoGrantAllowed` 同思路的来源门禁：免审批模式只在
     * “来源可信”时生效（用户在本机显式配置），避免远程/外部调用先写用户默认、
     * 再以缺省权限派发的方式间接获得宿主任意命令执行能力。
     */
    isSettingsUnrestrictedModeGrantAllowed(): Promise<boolean>;
}
//# sourceMappingURL=session-host-protocol.d.ts.map