import { type AgentTask } from '../agent-task/agent-task-protocol';
import type { MultitaskSessionRef } from './types';
export interface CoordinatorAcpBridgeHandle {
    detach(): void;
}
export interface CoordinatorAcpBridgeArgs {
    task: AgentTask;
    /** 协调器（父）会话。 */
    parentSession: MultitaskSessionRef;
    /** 协调器那次 Agent 工具调用的 callId，即 Web / WorkBuddy 上那张 Agent 卡。 */
    parentToolUseId?: string;
    /** Detached worker 的展示名；不赋予 Team member 语义。 */
    displayName?: string;
}
/**
 * 多任务协调器 detached worker 的 ACP 桥。
 *
 * 为什么存在：detached worker 的 AgentTask 协议故意不把 combineSubject / model / phase
 * 转发到父会话（Team 与普通 run_in_background Agent 都依赖这个语义，不能动）；而父会话
 * 的 ACP 转发（createEventForwardingPromise）随 prompt 结束退订。于是 Web / WorkBuddy
 * 只能看到一张秒结束的 Agent 卡，看不到 worker 的任何动作。
 *
 * 桥的做法（全部发生在 multitask 层，不改通用 detached / ACP 语义）：
 * 1. 挂上时机：spawnDetachedNoTeam 在 task.init + register 之后调用本函数。
 * 2. attach 时同步合成一张标准 Agent 卡（tool_call）：协调器在 REPL 沙箱里调 Agent，
 *    沙箱的 tool_call 帧不会落到父会话，Web 侧本来没有这张卡。合成帧复用
 *    convertInputItemToAcp（run_in_background: true 推出 isBackground），
 *    不传 parentToolUseId，因此它是顶层卡、不带 parentToolCallId meta。
 * 3. worker session 在 execute() 的 setupPhase 才创建，靠 onMultitaskWorkerSession
 *    （markWorkerSession 触发）在创建的同一调用栈里订它的 combineSubject。
 * 4. 事件转成 ACP update 后直发父会话当前绑定的所有连接（含发起方），
 *    sessionId 用父会话 id + _meta parentToolCallId 嵌套到那张 Agent 卡下。
 * 5. 每条 worker `tool_call` 发出后必须 `notifyToolCallSent`（与 AcpTeamBridge 同款）。
 *    handleToolApproval 会等 toolCallSentDeferreds；父 combineSubject 收不到 detached
 *    帧，不通知的话 AskUserQuestion 的 requestPermission 永远发不出去，卡片上只剩
 *    「[已跳过]」，后续主会话自己再问也会被 AskService 单例盖掉。
 * 6. worker 到终态时补一帧该卡的 tool_call_update（completed / failed + 结果摘要），
 *    然后拆订阅；订阅跟 worker 生命周期，不跟父会话 prompt——父会话 end_turn 后照常发。
 * 7. 绝不写父会话任何 subject：父会话 phase / runState 保持 idle。
 */
export declare function attachCoordinatorAcpBridge(args: CoordinatorAcpBridgeArgs): CoordinatorAcpBridgeHandle;
