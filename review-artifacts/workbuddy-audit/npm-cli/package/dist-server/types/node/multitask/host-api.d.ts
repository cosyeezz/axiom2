import { ACP_META_UNSOLICITED_TURN, ACP_METHOD_SESSION_SET_MULTITASK, buildSetMultitaskParams, buildUnsolicitedTurnUpdate, isMultitaskSupportAdvertised, readUnsolicitedTurn, type SetMultitaskRequest, type SetMultitaskResponse, type UnsolicitedTurnAnnouncement } from '@genie/agent-client-protocol';
import { type EnterMultitaskResult } from './slash-entry';
import type { MultitaskSessionRef } from './types';
export { ACP_META_UNSOLICITED_TURN, ACP_METHOD_SESSION_SET_MULTITASK, buildSetMultitaskParams, buildUnsolicitedTurnUpdate, isMultitaskSupportAdvertised, readUnsolicitedTurn, };
export type { SetMultitaskRequest, SetMultitaskResponse, UnsolicitedTurnAnnouncement };
/** initialize.agentCapabilities 上的能力位。与 mainAgentSupport 独立。 */
export declare const MULTITASK_ACP_CAPABILITY_KEY: "multitaskSupport";
/** 标准 ACP configOptions / session/set_config_option 使用的配置 ID。 */
export declare const MULTITASK_CONFIG_OPTION_ID: "multitask";
export interface MultitaskConfigOption {
    type: 'boolean';
    id: typeof MULTITASK_CONFIG_OPTION_ID;
    name: string;
    description: string;
    category: '_codebuddy.ai/multitask';
    currentValue: boolean;
}
export declare function resolveMultitaskAcpSupport(): boolean;
/** 标准 ACP 客户端可直接从 configOptions 发现并渲染 Multitask 开关。 */
export declare function buildMultitaskConfigOption(session: MultitaskSessionRef | null | undefined): MultitaskConfigOption | undefined;
/** 委托 overlay 的 ACP 配置 ID（替代已删除的权限模式 `delegate`）。 */
export declare const DELEGATE_CONFIG_OPTION_ID: "delegate";
/** 旧客户端 setMode('delegate') / set_config_option(mode,'delegate') 的明确拒绝文案。不做别名兼容。 */
export declare const REMOVED_DELEGATE_PERMISSION_MODE_MESSAGE: string;
export declare function isRemovedDelegatePermissionMode(modeId: unknown): boolean;
export interface DelegateConfigOption {
    type: 'boolean';
    id: typeof DELEGATE_CONFIG_OPTION_ID;
    name: string;
    description: string;
    category: '_codebuddy.ai/delegate';
    currentValue: boolean;
}
/** 委托开关。调用方负责连接维度门控（仅 mainAgentSupport 连接下发）。 */
export declare function buildDelegateConfigOption(session: MultitaskSessionRef | null | undefined): DelegateConfigOption | undefined;
/** enabled true/false/省略 = 进入/退出/toggle。 */
export declare function applyDelegateFromAcp(session: MultitaskSessionRef | null | undefined, enabled?: unknown): EnterMultitaskResult;
export interface SetMultitaskLivePeer<T> {
    getCurrentSession?: () => T | undefined;
    getCurrentSessionId?: () => string | undefined;
}
export interface SetMultitaskLiveLookup<T extends {
    id?: string;
}> {
    current?: T | null;
    alsCurrent?: T | null;
    subject?: T | null;
    peers?: Iterable<SetMultitaskLivePeer<T>>;
}
export type SetMultitaskLiveHit<T> = {
    kind: 'live';
    session: T;
} | {
    kind: 'unbound';
} | {
    kind: 'idle';
};
/** 盖章必须打在活对象上。get() 是磁盘副本，打上去 RPC 仍 ok、运行中协调器不变。 */
export declare function findLiveSetMultitaskSession<T extends {
    id?: string;
}>(sessionId: string, lookup: SetMultitaskLiveLookup<T>): SetMultitaskLiveHit<T>;
/** 只比 acpConnectionId。调用方缺 id fail-closed；会话无 owner 时已识别连接可认领。 */
export declare function isMultitaskSessionOwnedByConnection(session: {
    meta?: Record<string, unknown>;
} | null | undefined, connectionId?: string): boolean;
/** enabled true/false/省略 = 进入/退出/toggle。非空白也可进。 */
export declare function applyMultitaskFromAcp(session: MultitaskSessionRef | null | undefined, enabled?: unknown): EnterMultitaskResult;
export declare function toSetMultitaskResponse(result: EnterMultitaskResult, session?: MultitaskSessionRef | null): SetMultitaskResponse;
/** 标准 ACP 写入：session/set_config_option + id=multitask + JSON boolean。 */
export declare function buildSetMultitaskConfigOptionParams(sessionId: string, enabled: boolean): {
    sessionId: string;
    configId: typeof MULTITASK_CONFIG_OPTION_ID;
    type: 'boolean';
    value: boolean;
};
export declare function readMultitaskConfigCurrentValue(configOptions: Array<{
    id?: unknown;
    type?: unknown;
    currentValue?: unknown;
}> | null | undefined): boolean | undefined;
