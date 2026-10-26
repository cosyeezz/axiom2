import { Session } from '../../vendor/cbc-core/node/index.js';
import { type MainAgentAcpDeps, type MainAgentDirectoryEntry } from './main-agent-acp-handler';
export declare const TUI_MODE_DISABLED_MESSAGE = "Main agent mode switching is disabled. Set codebuddy.mainAgent.enabled=true, or CODEBUDDY_MAIN_AGENT_ENABLED=1.";
export declare const TUI_MODE_UNOPTED_MESSAGE = "This session belongs to a host that does not support main agent modes (WorkBuddy stays on Standard).";
export declare const TUI_MODE_LOCKED_MESSAGE = "Mode cannot be changed after the conversation starts. Use /clear, then /agent-mode.";
/** Empty-input help row. Only advertise /agent-mode while the session can still switch. */
export declare function formatTuiModeHelpHint(switchable: boolean): string;
export interface NativeMainAgentSnapshot {
    enabled: boolean;
    sessionBlank: boolean;
    currentAgentName: string;
    displayName: string;
    agents: MainAgentDirectoryEntry[];
    error?: string;
}
export type TuiModeCommandResult = {
    kind: 'panel';
} | {
    kind: 'message';
    text: string;
};
export type MainAgentQueryMatch = {
    kind: 'exact';
    agent: MainAgentDirectoryEntry;
} | {
    kind: 'none';
} | {
    kind: 'ambiguous';
    agents: MainAgentDirectoryEntry[];
};
/** 订阅：/agent-mode 切换后刷新 headerData（驱动 input-hint-box 的 /agent-mode to switch 提示）。 */
export declare function subscribeMainAgentDisplayChange(listener: () => void): () => void;
export declare function notifyMainAgentDisplayChange(): void;
/**
 * TUI native **新空白**会话：先盖进程 `--agent`（含 mainAgent 自定义），再盖
 * settings default / lastUsed，最后（仅传入 `tuiFallbackName` 时）兜底到该名字。
 * ACP / WorkBuddy（hostKind=unopted）/ 已有历史 / 正在跑的回合都不走这里。
 *
 * `tuiFallbackName` 是 TUI 入口专属的默认主 agent：只在没有 `--agent`、settings default、
 * lastUsed 时生效，由调用方按 `TuiModeService.isTuiMode()` 决定是否传入。
 */
export declare function stampLastUsedOnNativeSession(session: Session, options?: {
    isAcp?: boolean;
    deps?: MainAgentAcpDeps;
    processAgentName?: string;
    tuiFallbackName?: string;
}): Promise<void>;
export declare function createNativeMainAgentDeps(overrides?: Partial<MainAgentAcpDeps>): MainAgentAcpDeps;
export declare function sortMainAgentDirectory(agents: MainAgentDirectoryEntry[]): MainAgentDirectoryEntry[];
export declare function matchMainAgentQuery(query: string, agents: MainAgentDirectoryEntry[]): MainAgentQueryMatch;
export declare function isMainAgentSwitchLocked(session: Session): boolean;
export declare function formatLockedModeMessage(snapshot: Pick<NativeMainAgentSnapshot, 'displayName' | 'currentAgentName'>): string;
export declare function formatMainAgentList(snapshot: NativeMainAgentSnapshot, options?: {
    locked?: boolean;
}): string;
export declare function formatSetAgentError(error: unknown): string;
export declare function loadNativeMainAgentSnapshot(session: Session, deps?: MainAgentAcpDeps): Promise<NativeMainAgentSnapshot>;
export declare function runTuiModeCommand(input: {
    args: string[];
    session: Session;
}, deps?: MainAgentAcpDeps): Promise<TuiModeCommandResult>;
