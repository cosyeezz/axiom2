/**
 * WorkBuddy 产品专属命令安全策略模块
 *
 * 本模块为 WorkBuddy Desktop 提供独立的命令安全分级策略覆盖，
 * 与通用的 command-utils.ts 分级逻辑隔离，确保不影响 CodeBuddy 产品。
 *
 * ## 架构设计
 *
 * 采用**后置包装**模式：通用策略先执行完毕得到结果，再由本模块统一做二次判定。
 * 唯一的外部入口是 `applyWorkBuddyCommandPolicy(baseResult, normalizedCommand, mainCommand)`，
 * 在 command-utils.ts 的 `checkSingleCommandSafety` 返回后调用。
 *
 * ```
 * checkSingleCommandSafety(cmd)
 *   → 通用策略结果 baseResult
 *   → applyWorkBuddyCommandPolicy(baseResult, cmd, mainCmd, sandboxContext?)
 *       - 非 WorkBuddy → 直接透传
 *       - CRITICAL / HIGH → 直接透传（不降级）
 *       - 通用策略未识别的命令（isUnknown: true） → 走 WorkBuddy 自有白名单 + 智能兜底
 *         ↳ 有 sandboxContext 时：根据 actionMask 精确判定（DELETE→HIGH，其他→SAFE）
 *       - 通用策略明确识别的命令（isUnknown 为 falsy）→ 保持原判
 * ```
 *
 * ## 策略差异（相比 CodeBuddy）
 *
 * - **未知命令默认等级**：LOW（CodeBuddy 也是 LOW）
 *   WorkBuddy 依赖沙盒作为安全网：即使命令被放行执行，沙盒仍会拦截
 *   文件删除操作并触发 post-exec 提权。对命令名或参数含破坏性关键词
 *   （delete/destroy/purge 等）的未知命令会提升为 HIGH。
 * - **LOW 风险白名单**：保留会触发文件写操作（可能被 sandbox-exec 拦截）的
 *   常用开发命令，标记为 LOW 风险（需确认，可缓存）。纯只读命令无需列入，
 *   因为它们不会触发写操作，不会被 sandbox 拦截。
 *
 * ## 扩展方式
 *
 * 1. 若命令会触发文件写操作且在开发中常用，添加到 `WORKBUDDY_LOW_RISK_WHITELIST`
 * 2. 无需修改 command-utils.ts
 */
/** 命令安全检查结果（镜像自 command-utils.ts，避免循环导入） */
export interface WorkBuddyCommandSafetyCheck {
    isSafe: boolean;
    requiresApproval: boolean;
    riskLevel: string;
    /** 命令未被任何白名单或已知风险模式识别，属于兜底判定。仅在兜底分支设置为 true。 */
    isUnknown?: boolean;
    reason?: string;
}
/**
 * 沙盒运行时上下文 — 当命令已在沙盒中执行并被拦截时，
 * 调用方可传入此信息让策略做更精确的风险判定。
 *
 * 典型场景：post-exec 阶段沙盒拦截了某些文件操作，
 * 策略需要结合 actionMask 判断实际风险等级。
 */
export interface SandboxBlockContext {
    /** 沙盒拦截的文件操作记录（actionMask: 0x01=READ, 0x02=WRITE, 0x04=DELETE, 0x08=EXECUTE） */
    fileBlockRecords: ReadonlyArray<{
        path: string;
        actionMask: number;
    }>;
}
/**
 * WorkBuddy LOW 风险白名单 — 这些命令在 WorkBuddy 下视为 LOW（需确认，可缓存）。
 *
 * 收录标准：
 * - 命令可能触发文件写操作，会被 sandbox-exec 拦截
 * - 在开发场景中较常用，完全阻断会严重影响体验
 * - 操作通常可恢复，风险低于 MEDIUM
 * - 不在通用 SAFE_COMMAND_WHITELIST 中
 *
 * 注意：纯只读命令（如 ping、dig、pgrep 等）无需列入此白名单，
 * 因为它们不会触发文件写操作，不会被 sandbox-exec 拦截，
 * 且已被通用策略或系统默认行为覆盖。
 */
export declare const WORKBUDDY_LOW_RISK_WHITELIST: ReadonlySet<string>;
/**
 * WorkBuddy 未知命令中，命令名本身包含破坏性关键词时的风险等级。
 *
 * 当命令不在任何白名单中且未命中通用风险模式，但命令名包含
 * delete/remove/drop/destroy/purge/kill/wipe 等关键词时，判为 HIGH。
 */
export declare const WORKBUDDY_DESTRUCTIVE_UNKNOWN_RISK_LEVEL: "high";
/**
 * WorkBuddy 未知命令的默认风险等级。
 *
 * 当命令不在任何白名单中且未命中任何风险模式时，使用此等级。
 * 采用 LOW（需确认但可缓存）——因为真正危险的操作（rm -rf、DROP DATABASE 等）
 * 已在通用策略的 CRITICAL/HIGH/MEDIUM 正则中被拦截，走到这里的未知命令
 * 本质上是"不在白名单中的普通开发工具"（如 mysql.server、pg_ctl 等），
 * 直接阻断会严重影响开发体验。
 *
 * 安全保障：
 * - 破坏性命令（rm/delete/drop 等）已被通用策略正则匹配为 CRITICAL/HIGH/MEDIUM
 * - 命令名本身含破坏性关键词（如 xxx-delete、cleanup-xxx）会被提升为 HIGH
 * - 沙盒仍然生效，即使放行也在沙盒内执行，真正的文件删除会被沙盒拦截
 */
export declare const WORKBUDDY_DEFAULT_UNKNOWN_RISK_LEVEL: "low";
/**
 * WorkBuddy 命令安全策略后置包装器。
 *
 * **调用前提**：调用方已确认当前为 WorkBuddy Desktop 环境（isWorkBuddyDesktop() === true）。
 *
 * 在通用策略（checkSingleCommandSafety）执行完毕后调用，对结果做二次判定：
 *
 * 1. **CRITICAL / HIGH** → 直接透传（不降级，保持安全底线）
 * 2. **通用策略未识别的命令**（isUnknown: true） → 走 WorkBuddy 自有白名单 + 智能兜底
 *    - 命中白名单 → LOW
 *    - 命令名含破坏性关键词（delete/remove/drop 等）→ HIGH
 *    - 有 sandboxContext 且涉及 DELETE 操作 → HIGH
 *    - 有 sandboxContext 且仅涉及非 DELETE 操作 → SAFE（自动放行）
 *    - 其他 → LOW（沙盒仍生效作为安全网）
 * 3. **通用策略明确识别的命令**（isUnknown 为 falsy）→ 保持原判
 *
 * @param baseResult - 通用策略的检查结果
 * @param normalizedCommand - 完整的归一化命令字符串（小写）
 * @param mainCommand - 提取后的主命令名
 * @param sandboxContext - 可选的沙盒运行时上下文（post-exec 拦截时传入）
 * @returns 最终的安全检查结果
 */
export declare function applyWorkBuddyCommandPolicy(baseResult: WorkBuddyCommandSafetyCheck, normalizedCommand: string, mainCommand: string, sandboxContext?: SandboxBlockContext): WorkBuddyCommandSafetyCheck;
