import type { Session } from '../../vendor/cbc-core/node/index.js';
/** 写席位：`undefined` 清除（钝化收尾），字符串置换（per-query 提供即置换，省略保持）。 */
export declare function setSessionRemoteAgentsUrl(session: Session, url: string | undefined): void;
/** 会话席位按值直读；无会话/未写入返回 undefined（调用方回落进程 env）。 */
export declare function resolveSessionRemoteAgentsUrl(session: Session | undefined): string | undefined;
/**
 * 宿主随会话发现源一并声明的策略（QueryOptions.remoteAgentsTrusted /
 * remoteAgentsEnabled），是进程 env CODEBUDDY_A2A_TRUSTED_RESULTS /
 * CODEBUDDY_A2A_OUTBOUND_ENABLED 的会话席位：
 * - trusted：该会话发现源中 Agent 的返回可信，免于防注入检测；
 * - enabled：宿主为该会话打开出站 A2A 特性开关（与 env 覆盖一样只能打开，
 *   false 回落 ProductFeature 判定）。
 * 只对**会话自己表态的发现源**生效（席位未写入时不作用于进程源）。
 */
export interface SessionRemoteAgentsPolicy {
    readonly trusted: boolean;
    readonly enabled: boolean;
}
/** 写策略席位：`undefined` 清除（钝化收尾），对象整体置换（per-query 提供即置换，省略保持）。 */
export declare function setSessionRemoteAgentsPolicy(session: Session, policy: SessionRemoteAgentsPolicy | undefined): void;
/** 会话策略席位按值直读；无会话/未写入返回 undefined。 */
export declare function resolveSessionRemoteAgentsPolicy(session: Session | undefined): SessionRemoteAgentsPolicy | undefined;
