import type { AgentJobState } from './agent-view-protocol';
/**
 * 生命周期写（重启、回收）会刷新 updatedAt/idleSince。旧记录还没有 lastActivityAt 时，
 * 先把写之前能代表「上次对话」的时间固化下来，之后的生命周期写就不会再改变它的排序。
 */
export declare function carryLastActivity(state: AgentJobState): Pick<AgentJobState, 'lastActivityAt'> | Record<string, never>;
