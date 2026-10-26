/**
 * 子 agent 的 mods 生命周期 —— 官方 `agent.spawn` 与子 agent 的 `turn.complete`。
 *
 * ## `agent.spawn`：`next(e)` 等到子 agent 真的起来
 *
 * 官方：「A subagent or an agent team teammate is about to start」，`next(e)` 解析
 * 成 `{ agentId, model }`（hook 拿 `agentId` 去对齐后续 `turn.step` / `tool.call` /
 * `turn.complete` 的 `e.agentId`）。cbc 在 AgentTool 里 dispatch，core 的答案是一个
 * 挂起的 Promise：hook 链走到 core 即放行宿主继续起子 agent，子会话建好、
 * SubagentStart 时再 resolve。hook 在 core 之前就回了答案（`{ deny }` 等）则宿主
 * 照答案办，不起子 agent。
 *
 * ## 子 agent 的 `turn.complete`
 *
 * 主循环的轮次由 SessionRunStateMachine 观察（mods-lifecycle-observer）；子 agent
 * 的会话不在那条链上，结束点是 AgentTask 的收尾。`agentId` 与 `turn.step` /
 * `tool.call` 用同一个值：子会话 id。
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
/**
 * dispatch `agent.spawn`。返回 hook 在 core 之前给出的答案（宿主按它办），
 * 或 `undefined`：hook 放行，宿主继续起子 agent，并在 SubagentStart 时
 * `settleModsAgentSpawn`。
 */
export declare function dispatchModsAgentSpawn(input: Record<string, unknown> & {
    tool_use_id: string;
}): Promise<{
    deny: string;
} | {
    proceed: Record<string, unknown>;
} | undefined>;
/** The spawn returned without a subagent session of its own (a teammate, a resume): `next(e)` gets `{ model }`. */
export declare function settleModsAgentSpawn(toolUseId: string | undefined, model: string): void;
/** 子 agent 没能起来（报错 / 被拒）：让等在 `next(e)` 上的 hook 收到 `{ deny }`。 */
export declare function failModsAgentSpawn(toolUseId: string | undefined, reason: string): void;
export declare function subagentSessionOf(agentId: string): Session | undefined;
export declare function noteModsSubagentStart(toolUseId: string | undefined, session: Pick<Session, 'id'>, model: string | undefined): void;
/** 子 agent 收尾：官方 `turn.complete`，`agentId` 是子会话 id。 */
export declare function noteModsSubagentEnd(session: Session | undefined, status: string | undefined): void;
