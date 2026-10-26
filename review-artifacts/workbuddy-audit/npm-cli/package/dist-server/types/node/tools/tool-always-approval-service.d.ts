import { Session } from '../../vendor/cbc-core/node/index.js';
import { ApprovalScope, RuleValue, RunToolApprovalItem, ToolExecuteArgument } from '../../vendor/cbc-shared/node/index.js';
import { ToolAlwaysApprovalService } from './tool-protocol';
/**
 * 宿主注入的「审批记忆分组」（通用机制，不绑定任何具体工具）。
 *
 * 默认不设置 —— 每个工具各记各的，与历史行为一致。
 *
 * 动机：审批记忆的天然粒度是单个工具名，但一件用户心智上的「同一件事」可能由多个
 * 兄弟工具承载（例如同一种产物的几条不同输入路径）。此时用户对其中一个点了
 * 「本次会话始终允许」，换一条路径就会被重新询问 —— 用户视角是「我明明允许过了」。
 * 宿主把这些工具声明成一组后，组内任一工具被记住，同组其余工具即视为已授权。
 *
 * 值为 JSON：`{"<组名>": ["<工具名>", ...], ...}`。
 * 解析失败 / 格式不合法时整体退回单工具语义（**不放宽**授权，只是不合并），
 * 绝不让配置错误把审批链路搞崩。
 */
export declare const ENV_APPROVAL_MEMORY_GROUPS = "CODEBUDDY_APPROVAL_MEMORY_GROUPS";
/**
 * 宿主注入的命令门禁声明（JSON 对象数组 `[{ pattern, approvalKind, skillName? }]`，
 * issue #139526）。默认不设置 —— 没有命令门禁时整体 no-op。
 *
 * 命中这些特征的 Bash 调用（如技能脚本执行）把「本次会话始终允许」记为**命令级**记忆：
 * 状态文件的 `commands` 字段 + 内存签名 `Bash:cmd:<pattern>`。绝不写 Bash 工具级
 * allow 规则 —— 一次批准放行会话内所有 Bash 调用是安全事故级放大（含未来其它命令门禁）。
 */
export declare const ENV_COMMAND_APPROVAL_PATTERNS = "CODEBUDDY_COMMAND_APPROVAL_PATTERNS";
export declare class ToolAlwaysApprovalServiceImpl implements ToolAlwaysApprovalService {
    private readonly storeMap;
    getSessionApprovalRules(session: Session, item: RunToolApprovalItem): RuleValue[];
    approve(session: Session, item: RunToolApprovalItem, scope?: ApprovalScope, ruleToolName?: string): Promise<void>;
    /**
     * 把一次「本次会话始终允许」落到磁盘状态文件，供宿主闸门 hook 跨进程读回。
     *
     * 仅当工具命中宿主 `CODEBUDDY_APPROVAL_MEMORY_GROUPS` 分组声明且 scope 为 session 级
     * 时落盘（其它工具没有 hook 消费方；持久授权走 settings，本就不受进程更替影响）。
     * 全程 fail-soft：任何异常吞掉 —— 落盘失败最多下个进程周期多弹一次窗，
     * 绝不能让用户的审批操作失败。
     */
    private persistSessionApprovalIfDeclared;
    /**
     * 把一次「本次会话始终允许」的命令门禁记忆落到磁盘状态文件（issue #139526）。
     *
     * 与 `persistSessionApprovalIfDeclared`（MCP 工具级/组级）共用同一份状态文件与
     * tmp+rename 的原子写，各记忆通道互不改写对方的字段。读侧是 `isCommandGateApproved`；
     * 落盘而不只放内存，是为了 CLI 进程被回收重启后同一会话继续时，放行记忆仍在。
     *
     * 全程 fail-soft：落盘失败最多下个进程周期多弹一次窗，绝不能让用户的审批操作失败。
     */
    private persistCommandSessionApproval;
    /** 任务级命令门禁放行（issue #139526）：同一 requestId 内的后续脚本执行不再弹窗。 */
    private persistCommandTurnApproval;
    isApproved(session: Session, item: RunToolApprovalItem): boolean;
    clear(sessionId: string): void;
    private getOrCreateStore;
    private createStoreForTool;
    private readonly sessionCaches;
    private getSessionCache;
    private getToolSignature;
    /**
     * Bash 命令命中的命令门禁特征（issue #139526）；非 Bash / 未命中 / 无门禁配置
     * 返回 undefined。
     *
     * 特征的唯一来源是技能包内的 `high-credit-commands.json`：宿主扫描后经
     * `ENV_COMMAND_APPROVAL_PATTERNS` 注入。
     */
    private resolveCommandGatePattern;
    /**
     * Skill 关联的脚本门禁特征（issue #139526）：env 声明里 `skillName` 与当前
     * Skill 匹配的 pattern。用于把 Skill 审批的放行同步到脚本门禁。
     */
    private resolveSkillCommandPattern;
    /**
     * 脚本门禁的「始终允许」反向同步到关联的 Skill（issue #139526）：记一条与 Skill 自身
     * 「始终允许」同口径的会话级签名，模型之后再加载该 Skill 不再弹窗。记在主会话上，
     * 子代理按 isApproved 的父会话回查同样命中。
     */
    private rememberLinkedSkillApproval;
    /**
     * 单次确认的任务级记忆入口（SessionApprovalMemoryHost，issue #139526）。
     * 由中断服务在用户点「确认」（非始终允许）时调用；不适用时 no-op。
     */
    rememberTaskScopedApproval(session: Session, item: RunToolApprovalItem): void;
    /**
     * 「确认」路径的任务级记忆（issue #139526）。
     *
     * 命令门禁：记录 (pattern, requestId)，同一用户请求内的后续脚本执行不再弹窗
     * （一次任务里脚本重试/多步执行不重复打扰）。
     * Skill 审批：该 Skill 关联了脚本门禁声明时同样记任务级放行 —— 用户确认过一次
     * 图片处理任务后，该任务内的脚本执行不应再弹。
     * 其余工具在此 no-op，保持既有单次放行语义不变。
     */
    private rememberTaskScopedScriptApproval;
    /**
     * 匹配 Bash 命令门禁声明（issue #139526，宿主 env 注入）；命中返回 pattern 与文案 kind。
     * 由 Bash 审批阶段的内建判定调用（`ToolPermissionService.applyCommandGate`，
     * 沙箱与非沙箱两条路径）。
     */
    matchCommandGate(toolName: string, input: ToolExecuteArgument<any>): {
        pattern: string;
        approvalKind: string;
    } | undefined;
    /**
     * 命令门禁是否已放行（issue #139526）：
     * - 内存签名（`Bash:cmd:<pattern>`，本进程内点过「始终允许」）；
     * - 状态文件 `commands`（会话级）与 `turnCommands`（当前用户请求，匹配 requestId）。
     * 任一命中即不再弹窗；读盘失败按「无记忆」处理（继续弹窗，fail-closed 方向）。
     */
    isCommandGateApproved(session: Session, pattern: string): boolean;
    /**
     * 工具名 → 审批记忆键：命中宿主声明的分组时返回组 key，否则原样返回工具名。
     *
     * 只影响「记住/复用」的粒度，不影响是否需要审批 —— 没被用户显式批准过的组，
     * 第一次仍会正常弹窗。
     */
    private resolveMemoryKey;
    private checkSafety;
    /**
     * 向上同步授权到主 session
     * 当 subagent 中用户选择 "don't ask again this session" 时，
     * 同时将缓存和规则同步到主 session，使授权在整个会话范围内生效
     */
    private syncApprovalToMainSession;
    /**
     * Resolve approval rules based on tool type and arguments.
     *
     * This method generates appropriate RuleValue(s) for different tool types.
     *
     * Most tools use a tool-name rule for the session. Skill is target-scoped so
     * approving one Skill cannot silently approve every other Skill.
     *
     * For more granular control, users should use settings-based rules like:
     * - Bash(npm run *) - allow specific command patterns
     * - Edit(src/*.ts) - allow specific file patterns
     *
     * @param item The tool approval item containing tool name and arguments
     * @returns Array of RuleValue objects for the permission update
     */
    private resolveApprovalRules;
    private resolveApprovalTarget;
    /** 与 toolName 同组的全部工具名；未分组时返回空数组。 */
    private resolveGroupMembers;
    private resolveStableSkillName;
}
