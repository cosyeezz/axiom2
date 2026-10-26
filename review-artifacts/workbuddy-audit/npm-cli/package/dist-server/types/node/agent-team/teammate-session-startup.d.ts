/**
 * 独立进程 teammate 的**会话启动落地**（issue #127405 · P7 / R6）。
 *
 * teammate 的会话由本进程自建（teammate-runner），不走 SessionMiddleware 的
 * `/internal/agent` 准入 —— 于是 `SessionStartupApplier.updatePermissionMode`
 * （CLI flag / `-y` / settings 三条入口的**唯一落地实现**）从不被调用：
 * `permissionModeSubject` 恒为 `Default`，进程级 `--permission-mode`、`-y`、
 * settings `permissions.defaultMode` 全部抬不动。后果是需要审批的工具走到
 * `WAITING_FOR_PERMISSION`（无超时、无默认决策）—— 没有 ACP 宿主订阅时就是挂起。
 *
 * 两步，顺序不能反：
 * 1. 把**本进程 CLI 快照**里的权限档种进 `session.options`（applier 只读会话，
 *    不读 argv；teammate 会话是 `sessionManager.create()` 裸建的，options 本来是空的）；
 * 2. 调用 `updatePermissionMode` 落地：校验、auto 可用性门禁、settings 兜底都在那一份
 *    实现里，别在这里自己再判一遍。
 */
import { type Session, SessionStartupApplier } from '../../vendor/cbc-core/node/index.js';
/** 本进程 CLI 快照里与权限档有关的字段（其余字段各有入口，不在这里捎带）。 */
export interface TeammateCliPermissionSnapshot {
    permissionMode?: unknown;
    /** 与 `CliRuntimeOptions` 的快照形状对齐；为 true 时落地为 teammate 的 bypass 权限档。 */
    dangerouslySkipPermissions?: unknown;
}
export interface TeammateSessionStartupDeps {
    /** 读本进程 CLI 快照（测试注入用）。 */
    readCliPermission?: () => TeammateCliPermissionSnapshot | undefined;
    /** 被忽略的档要能被看见（测试注入用）。 */
    warn?: (message: string) => void;
    /** 权限档落地实现（测试注入用）；`null` = 明确当作「没有 applier」。 */
    applier?: Pick<SessionStartupApplier, 'updatePermissionMode'> | null;
}
/**
 * 把进程 CLI 快照里的权限字段种进会话选项（**不覆盖已有值**：会话上已有的来源更具体）。
 * `--permission-mode` 的值域与 CLI 同一张表（`isCliProcessPermissionMode`），别另写一份。
 */
/**
 * 种权限档的返回值：`rejected` = argv / 快照给了 CLI 不认的档（当前会被静默忽略）。
 * 调用方据此记一条 warn —— 否则「进程带了档、生效却不是它」只能靠翻日志猜。
 */
export interface TeammatePermissionSeedResult {
    /** CLI 不认、被忽略的档（有值就说明参数白给了）。 */
    rejected?: string;
}
export declare function seedTeammatePermissionOptions(session: Session, snapshot: TeammateCliPermissionSnapshot | undefined): TeammatePermissionSeedResult;
/**
 * 落地权限档；返回是否真的调到了 applier。
 * DI 缺 applier（精简变体）时返回 false —— 调用方记一条 warn，别让 teammate 起不来。
 */
export declare function applyTeammateSessionStartupPermissionMode(session: Session, deps?: TeammateSessionStartupDeps): Promise<boolean>;
