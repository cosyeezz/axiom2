import type { Session } from '../../vendor/cbc-core/node/index.js';
/** Bearer 凭据面 ≈ AuthToken 瘦版。 */
export interface RunAuth {
    /** → Authorization: Bearer（≈ AuthToken.accessToken）。Rotatable per query. */
    accessToken: string;
    /** 鉴权方式 → X-Auth-Method；并作 X-Userinfo.token_source（如 'oneid'）。 */
    method?: string;
    /** Optional host callback for an HTTP 401 before model streaming starts. */
    refresh?: (options: {
        signal: AbortSignal;
    }) => Promise<Pick<RunAuth, 'accessToken' | 'method'>>;
}
/** 身份属性面 ≈ Account 瘦版（字段名对齐内部模型）。 */
export interface RunAccount {
    /** ≈ Account.uid → X-User-Id（alias_id 子账号 UIN）。 */
    uid: string;
    /** ≈ Account.enterpriseId → X-Enterprise-Id（src_tid 主账号 UIN）。 */
    enterpriseId?: string;
    /** ID 体系归属 → X-Id-Source；并作 X-Userinfo.id_source（如 'tencentcloud'）。 */
    idSource?: string;
}
export interface RunIdentity {
    auth?: RunAuth;
    account?: RunAccount;
    /**
     * run-plane 附加 header（宿主扩展口）：压过字段组合、让位消费点的内部
     * 显式配置（absent-only 三层，见 runIdentityHeaders）。
     */
    headers?: Record<string, string>;
}
/**
 * Bind or replace the run identity. Per-query override (用户定稿) — unlike the
 * activation-scoped mounts, a later query's identity replaces the earlier
 * one so hosts can rotate tokens; a query without identity keeps the last
 * binding. `undefined` clears (passivation).
 */
export declare function setSessionRunIdentity(session: Session, identity: RunIdentity | undefined): void;
/**
 * The bound identity of the root scope; undefined outside runs and on
 * unbound sessions. Ambient by design: consumption points (model fetch
 * adapter, web tools) sit inside the run's async subtree, so no session
 * threads through signatures. Root, not current: the identity belongs to
 * the query's main session, and subagent runs (own current session, zero
 * bindings) must keep carrying it. Non-run callers (UI hooks, classifiers,
 * compaction) resolve undefined, and bootstrap is exactly what they should
 * use.
 */
export declare function resolveRunIdentity(): RunIdentity | undefined;
/** Refresh the bound run identity without modifying the process bootstrap login. */
export declare function refreshRunAuth(rejectedToken: string, signal: AbortSignal): Promise<RunAuth | undefined>;
/**
 * run-plane 身份归因 header 的单点组合（五个消费点共用）。合并序（三层
 * absent-only，从高到低）：消费点的内部显式配置（消费点侧保证）→
 * identity.headers（宿主显式，压过组合）→ 字段组合。刻意不含
 * Authorization——token 消费保持各点 `auth.accessToken ?? bootstrap` 纹理
 * （custom-model 优先级判例不动）；宿主坚持时可经 headers 自带。
 * X-Userinfo 仅在 enterpriseId/idSource/method 至少一个在场时组合。
 */
export declare function runIdentityHeaders(): Record<string, string>;
