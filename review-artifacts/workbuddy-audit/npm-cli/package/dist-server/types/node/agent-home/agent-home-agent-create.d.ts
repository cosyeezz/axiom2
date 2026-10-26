/**
 * 自治建同事：域逻辑（校验 + 配额 + provenance + 审计）。
 * 工具与 HTTP 共用同一份规则，不在两层各写一遍。
 *
 * 落盘必须进 withAgentHomeDirectoryLock；审计在锁内追加。
 */
import { type AgentHomeProfile } from './agent-home-directory';
import type { AgentHomeCreateErrorCode } from './agent-home-errors';
/** 归一 + 校验（纯函数）：返回 engine 供落盘，或 error 表示拒绝。 */
export declare function normalizeColleagueEngine(raw: unknown): {
    engine?: string;
    error?: 'ENGINE_NOT_ALLOWED';
};
/**
 * 新同事的家目录：显式指定 > 默认 Agent 建人走宿主启动目录 > 建人者家目录 > 最终兜底。
 *
 * 默认 Agent 的档案 homeCwd 可能停在历史目录（只在首次 bootstrap 记过一次），拿它当新
 * 同事的家目录会把 Run 带到旧目录 —— 他建人时以当前启动目录为准；同事建人仍继承自己的
 * 家目录（宿主目录在 job 进程里拿不到，自然回落）。
 */
export declare function resolveColleagueHomeCwd(input: {
    requested?: string;
    creatorIsDefault: boolean;
    creatorHomeCwd?: string;
    hostWorkDir?: string;
    fallbackWorkDir: string;
}): string;
export interface CreateColleagueInput {
    homeDir: string;
    /** 发起者 agentId；undefined = 用户经 HTTP 建人。 */
    creatorAgentId?: string;
    name: string;
    /** 'auto' = name 是占位名，主对话生成标题后自动换掉（见 agent-home-auto-name）。 */
    nameSource?: 'auto';
    /**
     * 用户在新建页亲手选定的头像；缺省或非法值交给 pickAgentHomeAvatarVariant 自动挑款。
     * 草稿转正时必须带上，否则盘上的脸和用户看了一路的那张对不上。
     */
    avatarVariant?: number;
    title?: string;
    description?: string;
    engine?: string;
    /** 固定跑哪个模型；缺省跟随产品默认。 */
    model?: string;
    /** 固定权限模式；必须是 CLI 认的值（见 isCliProcessPermissionMode）。 */
    permissionMode?: string;
    homeCwd?: string;
    now?: number;
}
export type CreateColleagueResult = {
    ok: true;
    agent: AgentHomeProfile;
} | {
    ok: false;
    error: AgentHomeCreateErrorCode;
};
export declare function createAgentHomeColleague(input: CreateColleagueInput): Promise<CreateColleagueResult>;
