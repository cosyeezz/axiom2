/**
 * 终止型策略拒绝（`terminal.reason === 'policy-denied'`）的收尾助手消息。
 *
 * 命令安全 deny 网关（`sandbox-orchestrator._handleCommandSafetyDenyGate`）、
 * PreToolUse hook 的 `continue:false` 等路径会给工具结果打上
 * `terminal: { reason: 'policy-denied', finalOutput }`；`cbc-core` 的
 * `toolUseBehavior` 见到它就以 `isFinalOutput: true` 结束本轮 run，**不会**把拒绝
 * 结果交回模型，于是这一轮没有任何助手产出。
 *
 * ACP 入口（`acp/acp-agent.ts`）早就在轮次收尾处把 `finalOutput` 补成一条助手
 * 消息；`/server` 入口（agent-harness / CodeBuddy IDE 走的那条）只把它放进
 * `QueryResult.assistantText` 就丢掉了，宿主因此「对话无提示结束」（#150536）。
 * 本模块把该补偿下沉到 server 轮次收尾，既发帧也写历史，重放时表现一致。
 */
import type { AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
/** 终止本轮的那条工具结果在 history 中的下标；没有则 -1。 */
export declare function findTerminalPolicyDenialIndex(history: readonly AgentInputItem[], finalOutput: string): number;
/**
 * 判断是否需要补一条助手消息：本轮确实因 policy-denied 终止，且那条工具结果之后
 * 没有任何助手消息（模型自己回过话时不重复补发）。
 */
export declare function needsTerminalPolicyDenialMessage(history: readonly AgentInputItem[], finalOutput: string): boolean;
/** 终止那条工具结果的 providerData —— 新消息沿用它的 messageId / 模型等元数据。 */
export declare function terminalPolicyDenialProviderData(history: readonly AgentInputItem[], finalOutput: string): Record<string, any>;
