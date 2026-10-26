/**
 * Nested product-interaction from inside a REPL cell.
 *
 * Broker `checkPermission` skips upgrading `ask` to a popup (the user already
 * approved the cell). That is correct for Write/Bash and wrong for tools whose
 * job *is* the interaction: AskUserQuestion needs `toolCallId` + `setAsk`,
 * ExitPlanMode needs the plan-approval panel.
 *
 * Do not use `session.state.approve/reject` here. CLI UI reject of a normal
 * tool interruption aborts the session (`interruption-service` ~833). Nested
 * calls must settle the cell without aborting the parent REPL run.
 *
 * Reuse the sandbox settle pattern (`_sandboxResolve` + `enqueueSandboxApproval`)
 * without sandbox UI flags. TUI/ACP dispatch on `rawItem.name`. A server host
 * answers through its canUseTool instead; nothing reads the queue there.
 */
import { type InterruptionService as IInterruptionService, type Session } from '../../../vendor/cbc-core/node/index.js';
import type { RunContext } from '@openai/agents';
import { type ToolResult } from '../tool-protocol';
export declare const REPL_PLAN_REJECTED_MESSAGE = "The user rejected the plan. Stay in plan mode, revise the plan, then call ExitPlanMode again.";
export declare const REPL_NESTED_NONINTERACTIVE_MESSAGE: string;
/**
 * 嵌套交互等待用户裁决的上限。
 *
 * 此前 waitForNestedDecision 只有 abort 出口：客户端没把这条审批渲染出来（PTC 下
 * Web UI 把 AskUserQuestion 当提问卡、卡上没有批准入口）、或用户直接关掉页面时，
 * Promise 永远不落地 —— 整轮 turn 挂在「等待工具结果」，jsonl 里只有
 * function_call REPL、没有 function_call_result，只能重启会话。
 *
 * 超时后按拒绝收尾：撤下卡片、把「无法等待用户确认」明确回给模型，让它改用正文提问，
 * 本轮的其它产出不再丢失。可用 CODEBUDDY_REPL_NESTED_TIMEOUT_MS 覆盖（测试/长任务）。
 */
export declare const DEFAULT_REPL_NESTED_DECISION_TIMEOUT_MS: number;
export declare function resolveReplNestedDecisionTimeoutMs(): number;
export declare const REPL_NESTED_TIMEOUT_MESSAGE: string;
export interface ReplNestedInteractionDeps {
    interruptionService: Pick<IInterruptionService, 'enqueueSandboxApproval' | 'reject'>;
    /**
     * 内嵌产品交互 UI 即将展示时回调（在真正 enqueue 弹窗前触发）。用于补发
     * Notification(permission_prompt)，对齐标准模式审批等待。仅在会真正弹 UI 时调用
     * （print/SDK 静默模式经 shouldAvoidNestedUi 提前返回，不会触发）。
     */
    onWillPrompt?: () => void | Promise<void>;
    execute: (toolName: string, params: Record<string, unknown>, context: RunContext<Session>, details: {
        toolCall: {
            callId: string;
            id: string;
            name: string;
            arguments: string;
        };
    }) => Promise<ToolResult>;
}
export declare function runReplProductInteraction(deps: ReplNestedInteractionDeps, context: RunContext<Session>, toolName: string, params: Record<string, unknown>, cellSignal?: AbortSignal): Promise<ToolResult>;
/**
 * 安全类 ask（命令安全检查 / 敏感文件）在 REPL 内层的用户批准 —— 对齐直连。
 *
 * 直连（标准模式）下这类 ask 会弹审批窗（HIGH/CRITICAL 命令每次确认、bypass 也不例外），
 * 用户批准后才执行。REPL 内层此前没有弹窗通道，broker 只能直接拦下（回
 * `High-risk command requires explicit approval`）——比直连"更严且没有出路"：
 * `git stash drop` / `git reset --hard` / 敏感文件读写等在 PTC 下完全不可执行。
 * 这里复用嵌套产品交互的同一机制（enqueueSandboxApproval + providerData._sandboxResolve）
 * 补上弹窗。
 *
 * 与 `runReplProductInteraction` 的差异：产品交互工具的 ask 就是产品本身（问答/计划面板），
 * 这里的 ask 是"带副作用工具调用的安全确认"，批准 = 放行该次调用。
 *
 * 不变量：
 * - 不使用 `session.state.approve/reject`（那会 abort 父 REPL run）；cell 取消/会话中止
 *   只撤下本次弹窗（waitForNestedDecision 同款 settle），本次调用按未获批准处理。
 * - 静默形态（print / SDK）不弹窗，回 `silent`，由调用方按既有安全口径拦截。
 * - UI 服务缺失回 `unavailable`，由调用方 fail-closed。
 */
export type ReplSecurityApprovalOutcome = 'approved' | 'denied' | 'silent' | 'unavailable';
export interface ReplSecurityApprovalDeps {
    interruptionService: Pick<IInterruptionService, 'enqueueSandboxApproval' | 'reject'>;
    /**
     * 审批 UI 即将展示时回调（在真正 enqueue 弹窗前触发）。用于补发 permission_prompt
     * 通知，对齐标准模式审批等待（同 `runReplProductInteraction` 的 onWillPrompt 语义）。
     */
    onWillPrompt?: () => void | Promise<void>;
}
export declare function requestReplSecurityApproval(deps: ReplSecurityApprovalDeps, session: Session, toolName: string, params: Record<string, unknown>, callId: string, cellSignal?: AbortSignal): Promise<ReplSecurityApprovalOutcome>;
/**
 * 合成审批项：name / arguments 就是被拦工具本身（Bash 的命令、Read 的路径），
 * UI 无需特化即可按普通工具审批卡渲染，与直连体验一致。
 *
 * providerData 同时带两个标记，各有用途：
 * - `REPL_NESTED_INTERACTION_META`（复用产品交互的标记）：向 ACP 声明"这是 REPL 内层
 *   合成审批、对话流里没有对应 tool_call"。**必须带**——acp-agent 的 handleToolApproval
 *   对不带此标记的 item 会等待"tool_call 已发送"的 deferred，而内层调用的 tool_call
 *   永远不会进对话流，缺失即死等、审批请求到不了客户端。与 AskUserQuestion/ExitPlanMode
 *   被豁免的原因是同一个结构性事实（模型调的是 REPL，不是内层工具）。
 * - `REPL_SECURITY_APPROVAL_META`：仅日志/诊断识别"这条审批来自 REPL 内层安全 ask"。
 */
export declare const REPL_SECURITY_APPROVAL_META = "codebuddy.ai/replSecurityApproval";
