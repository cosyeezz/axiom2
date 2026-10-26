/**
 * PR 状态刷新（M17）—— 回合结束时用 `gh pr view` 把 children 里的
 * PR 状态兜一遍，行尾标签的颜色（黄/绿/紫/灰）才有数据可依。
 *
 * best-effort：gh 不存在 / 未登录 / 网络失败一律静默保留旧状态。
 * 映射规则是纯函数（mapGhPrView），gh 调用与之分离便于单测。
 */
import { type AgentJobLink } from './agent-view-protocol';
/** `gh pr view --json` 里我们关心的字段 */
export interface GhPrView {
    state?: string;
    isDraft?: boolean;
    reviewDecision?: string;
    statusCheckRollup?: Array<{
        conclusion?: string | null;
        state?: string | null;
    }>;
}
/**
 * gh 返回 → 标签状态。
 * 优先级：merged/closed（终态）> draft > 检查失败 > 检查全绿 > open。
 */
export declare function mapGhPrView(view: GhPrView): NonNullable<AgentJobLink['status']>;
/** 查询单个 PR 的当前状态；查不到返回 undefined（保留旧状态） */
export declare function queryPrStatus(prNumber: number, cwd: string): Promise<NonNullable<AgentJobLink['status']> | undefined>;
/**
 * 刷新一组 children 的 PR 状态。
 * 返回刷新后的数组；没有任何变化时返回 undefined（调用方跳过写盘）。
 */
export declare function refreshPrStatuses(links: readonly AgentJobLink[], cwd: string, query?: typeof queryPrStatus): Promise<AgentJobLink[] | undefined>;
