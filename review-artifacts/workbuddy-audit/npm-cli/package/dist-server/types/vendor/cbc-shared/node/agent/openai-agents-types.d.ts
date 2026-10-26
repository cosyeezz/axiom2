/**
 * Re-exports types and classes from @openai/agents SDK, with lazy runtime bindings.
 *
 * ## Standby lazy 化（issue #107267）
 *
 * `@openai/agents(-core)` 合计 1228 KB 主 chunk 源码。standby 期 agent-loop /
 * model call / MCP transport / trace processor 全部不走，100% 冷代码。
 *
 * 之前顶部用 `import { Agent, RunContext, ... } from '@openai/agents'` static named
 * import runtime 值再 re-export，rspack 静态分析把整个 SDK pull 进主 chunk。改造：
 *
 *   1. 顶部改成 `import type { ... }`（TS elide、rspack 静态分析不 pull SDK）。
 *   2. Dual-name declaration merging：`type X = InstanceType<typeof XCtor>` 保留
 *      类型层（`x: Agent` / `Agent<any, any>` 都可用），`export let X: typeof XCtor`
 *      保留值层（`new Agent(...)` / `RunState.fromJSON(...)`）。
 *   3. `preloadOpenaiAgentsTypes()` 一次装载，assign 到 export let。
 *
 * ## 契约
 *
 * caller 使用 Agent / Runner / RunState / RunContext / RunResult / tool / user 等
 * 值符号前**必须**先 `await preloadOpenaiAgentsTypes()`。挂载点建议：
 *   - `PrewarmActivationCoordinator.fireActivation` 入口一次 preload 覆盖 activate
 *     后所有依赖方（agent-manager / runner-factory / memory-extraction / prompt-hook 等）
 *   - 或每个 caller 的公开 async 入口 preload 一次（幂等）
 *
 * 未 preload 直接用 `new Agent(...)` 会 fail-loud（TypeError: undefined is not
 * a constructor）——刻意设计，静默 sync require 回退会让整个 lazy 化归零。
 */
import type { addTraceProcessor as addTraceProcessorFn, Agent as AgentTypeCtor, AgentConfiguration, AgentInputItem as OriginalAgentInputItem, AgentOptions, AssistantMessageItem as OriginalAssistantMessageItem, ComputerCallResultItem as OriginalComputerCallResultItem, ComputerUseCallItem as OriginalComputerUseCallItem, FunctionCallItem as OriginalFunctionCallItem, FunctionCallResultItem as OriginalFunctionCallResultItem, FunctionTool as FunctionToolTypeCtor, Handoff as HandoffTypeCtor, handoff as handoffFn, HostedToolCallItem as OriginalHostedToolCallItem, Model as ModelType, ModelProvider as ModelProviderType, NonStreamRunOptions, OpenAIChatCompletionsModel as OpenAIChatCompletionsModelTypeCtor, OpenAIResponsesModel as OpenAIResponsesModelTypeCtor, ReasoningItem as OriginalReasoningItem, ResponseStreamEvent, RunConfig, RunContext as RunContextTypeCtor, RunItem, Runner as RunnerTypeCtor, RunResult as RunResultTypeCtor, RunState as RunStateTypeCtor, RunToolApprovalItem as RunToolApprovalItemTypeCtor, setTraceProcessors as setTraceProcessorsFn, StreamedRunResult as RawStreamedRunResultTypeCtor, StreamRunOptions, SystemMessageItem as OriginalSystemMessageItem, Tool as OpenAIToolType, tool as toolTypeCtor, ToolExecuteArgument, UnknownItem as OriginalUnknownItem, Usage as UsageTypeCtor, UserMessageItem as OriginalUserMessageItem } from '@openai/agents';
import type { AgentOutputType, getAllMcpTools as getAllMcpToolsFn, MaxTurnsExceededError as MaxTurnsExceededErrorTypeCtor, ModelBehaviorError as ModelBehaviorErrorTypeCtor } from '@openai/agents-core';
import type { TextOutput, UnknownContext, UserContent } from '@openai/agents-core/types';
import type { AcpTerminalStateItem, CreditUsageItem, FileHistorySnapshotItem, ModelUsageItem, RequestRecoveryItem, ResendForkNoticeItem } from './custom-input-item-types';
export * from './custom-input-item-types';
export type { RunStreamEvent } from '@openai/agents-core';
export type Agent<TContext = UnknownContext, TOutput extends AgentOutputType = TextOutput> = AgentTypeCtor<TContext, TOutput>;
export type RunContext<TContext = UnknownContext> = RunContextTypeCtor<TContext>;
export type Runner = RunnerTypeCtor;
export type RunResult<TContext, TAgent extends AgentTypeCtor<any, any>> = RunResultTypeCtor<TContext, TAgent>;
export type RunState<TContext, TAgent extends AgentTypeCtor<any, any>> = RunStateTypeCtor<TContext, TAgent>;
export type RunToolApprovalItem = RunToolApprovalItemTypeCtor;
export type Usage = UsageTypeCtor;
export type FunctionTool = FunctionToolTypeCtor;
export type Handoff<TContext = UnknownContext, TOutput extends AgentOutputType = TextOutput> = HandoffTypeCtor<TContext, TOutput>;
export type OpenAITool = OpenAIToolType;
export type OpenAIChatCompletionsModel = OpenAIChatCompletionsModelTypeCtor;
export type OpenAIResponsesModel = OpenAIResponsesModelTypeCtor;
export type Model = ModelType;
export type RawModelProvider = ModelProviderType;
export type MaxTurnsExceededError = MaxTurnsExceededErrorTypeCtor;
export type ModelBehaviorError = InstanceType<typeof ModelBehaviorErrorTypeCtor>;
export declare let Agent: typeof AgentTypeCtor;
export declare let RunContext: typeof RunContextTypeCtor;
export declare let Runner: typeof RunnerTypeCtor;
export declare let RunResult: typeof RunResultTypeCtor;
export declare let RunState: typeof RunStateTypeCtor;
export declare let RunToolApprovalItem: typeof RunToolApprovalItemTypeCtor;
export declare let RawStreamedRunResult: typeof RawStreamedRunResultTypeCtor;
export declare let Usage: typeof UsageTypeCtor;
export declare let tool: typeof toolTypeCtor;
export declare let Handoff: typeof HandoffTypeCtor;
export declare let handoff: typeof handoffFn;
export declare let OpenAIChatCompletionsModel: typeof OpenAIChatCompletionsModelTypeCtor;
export declare let OpenAIResponsesModel: typeof OpenAIResponsesModelTypeCtor;
export declare let getAllMcpTools: typeof getAllMcpToolsFn;
export declare let MaxTurnsExceededError: typeof MaxTurnsExceededErrorTypeCtor;
export declare let ModelBehaviorError: typeof ModelBehaviorErrorTypeCtor;
export declare function addTraceProcessor(processor: Parameters<typeof addTraceProcessorFn>[0]): void;
export declare function setTraceProcessors(processors: Parameters<typeof setTraceProcessorsFn>[0]): void;
/**
 * 拉起 `@openai/agents` + `@openai/agents-core` lazy chunk 并 assign runtime 值。
 * 幂等；并发 caller 复用同一次加载 promise。
 */
export declare function preloadOpenaiAgentsTypes(): Promise<typeof import('@openai/agents')>;
/** 识别步数上限错误；不会触发 SDK preload。 */
export declare function isMaxTurnsExceededError(err: unknown): boolean;
/** 识别模型行为错误及其工具参数子类；不会触发 SDK preload。 */
export declare function isModelBehaviorError(err: unknown): boolean;
/**
 * `@openai/agents` 运行时形状与本仓库假设不符时抛出。
 *
 * 刻意 fail-loud：唯一的「兜底」是回落到公开 `completed`，而那正是本类要消除
 * 的缺陷，静默回落等于把 bug 重新装回去。SDK 版本已 pin，形状变化会被单测
 * 在 CI 拦住，不会漏到用户侧。
 */
export declare class OpenaiAgentsCompatibilityError extends Error {
    constructor(message: string);
}
/** 等价 `err instanceof OpenaiAgentsCompatibilityError`；跨 bundle 副本也成立。 */
export declare function isOpenaiAgentsCompatibilityError(err: unknown): boolean;
/**
 * 取 stream run 的**物理**完成句柄（stream loop 真正跑完才 settle）。
 *
 * 只接受合法 thenable；方法缺失 / 抛错 / 返回 undefined / 返回非 thenable
 * 一律抛 {@link OpenaiAgentsCompatibilityError}，**不回落 `result.completed`**。
 *
 * 注意：settle ≠ 成功。调用方必须在 settle 后读 `result.error` 判定成败。
 */
export declare function getStreamPhysicalCompletion(result: unknown): PromiseLike<void>;
/**
 * 扩展属性，用于支持对话树结构
 */
interface ExtendedProperties {
    sessionId?: string;
    parentId?: string;
    logicalParentId?: string;
    timestamp?: number;
    cwd?: string;
    _fromSubAgent?: boolean;
    _detachedUsageOnly?: boolean;
}
export type UserMessageItem = OriginalUserMessageItem & ExtendedProperties;
export type AssistantMessageItem = OriginalAssistantMessageItem & ExtendedProperties;
export type SystemMessageItem = OriginalSystemMessageItem & ExtendedProperties;
export type FunctionCallItem = OriginalFunctionCallItem & ExtendedProperties;
export type FunctionCallResultItem = OriginalFunctionCallResultItem & ExtendedProperties;
export type HostedToolCallItem = OriginalHostedToolCallItem & ExtendedProperties;
export type ComputerUseCallItem = OriginalComputerUseCallItem & ExtendedProperties;
export type ComputerCallResultItem = OriginalComputerCallResultItem & ExtendedProperties;
export type ReasoningItem = OriginalReasoningItem & ExtendedProperties;
export type UnknownItem = OriginalUnknownItem & ExtendedProperties;
/**
 * Extended AgentInputItem with additional properties for conversation tree structure
 */
export type AgentInputItem = (OriginalAgentInputItem | CustomTitleItem | TopicItem | AiTitleItem | FileHistorySnapshotItem | SummaryItem | GoalResultItem | GoalProgressItem | TurnMetricsItem | ResendForkNoticeItem | AcpTerminalStateItem | RequestRecoveryItem | ModelUsageItem | CreditUsageItem) & ExtendedProperties;
export interface CustomTitleItem {
    type: 'custom-title';
    customTitle: string;
    sessionId: string;
    id?: string;
    providerData?: Record<string, any> | undefined;
}
export interface SummaryItem {
    type: 'summary';
    id?: string;
    summary: string;
    providerData?: Record<string, any> | undefined;
}
export interface TopicItem {
    type: 'topic';
    id?: string;
    topic: string;
    providerData?: Record<string, any> | undefined;
}
export interface AiTitleItem {
    type: 'ai-title';
    id?: string;
    aiTitle: string;
    sessionId: string;
    providerData?: Record<string, any> | undefined;
}
export interface GoalResultItem {
    type: 'goal-result';
    id?: string;
    ok: boolean;
    reason?: string;
    condition: string;
    durationMs: number;
    turnCount: number;
    tokenDelta: number;
    providerData?: Record<string, any> | undefined;
}
export interface GoalProgressItem {
    type: 'goal-progress';
    id?: string;
    condition: string;
    reason?: string;
    turnCount: number;
    createdAt?: number;
    providerData?: Record<string, any> | undefined;
}
export interface TurnMetricsItem {
    type: 'turn-metrics';
    id?: string;
    durationMs: number;
    tokenDelta: number;
    source?: 'turn' | 'background-task';
    taskStatus?: 'completed' | 'failed' | 'killed' | 'cancelled';
    providerData?: Record<string, any> | undefined;
}
export type { OriginalAgentInputItem, AgentConfiguration, AgentOptions, NonStreamRunOptions, ResponseStreamEvent, RunConfig, RunItem, StreamRunOptions, ToolExecuteArgument, };
/**
 * Wrapper function for creating user messages with UUID generation.
 * caller 必须先 `await preloadOpenaiAgentsTypes()`；否则 rawUserFn 为 undefined。
 */
export declare function user(input: string | UserContent[], options?: Record<string, any>): UserMessageItem;
export type StreamedRunResult<TContext, TAgent extends Agent<any, any>> = InstanceType<typeof RawStreamedRunResultTypeCtor> & {
    silentAbort: boolean;
    readonly __ctx?: TContext;
    readonly __agent?: TAgent;
};
//# sourceMappingURL=openai-agents-types.d.ts.map