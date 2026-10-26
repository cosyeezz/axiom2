import { HookInput } from '../../vendor/cbc-core/node/index.js';
import { PromptHookResult } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { PromptHookDefinition, PromptHookExecuteOptions, PromptHookService } from './hook-protocol';
/**
 * PromptHookService 实现
 *
 * 负责执行基于 LLM 的 Prompt Hook。
 *
 * 两种执行模式：
 * 1. 普通模式（PreToolUse 等）：使用 AgentService.runOneTime
 * 2. 带历史模式（Stop/SubagentStop）：直接使用 runner.run + RunState，
 *    避免消息显示到 UI，同时保留完整的对话历史（包括 function call）
 *
 * 注意：使用 ContainerUtil.get 动态获取依赖，避免循环依赖：
 * AgentService -> ToolManager -> ToolHookManager -> HookManager -> PromptHookService -> AgentService
 */
export declare class PromptHookServiceImpl implements PromptHookService {
    protected readonly logger: Logger;
    /**
     * 执行 Prompt Hook
     */
    execute(hook: PromptHookDefinition, input: HookInput, options?: PromptHookExecuteOptions): Promise<PromptHookResult>;
    /** The embedded Agent binds execution ownership; ordinary CLI calls keep their original path. */
    protected runOneTime(agentName: string, input: string): Promise<string>;
    /**
     * 使用 RunState 方式执行，包含完整对话历史
     *
     * 参考 PromptSuggestionService 实现：
     * - 复用 session.state 保证与主对话上下文一致
     * - 直接使用 runner.run 而不经过 interceptor，避免消息显示到 UI
     * - 保留原始历史数据（包括 function call 等）
     *
     * Stop / SubagentStop 路径：clone evaluator agent 后不修改单例的 model 字段，
     * 避免与并发的普通 prompt hook 调用产生 race（普通 prompt hook 直接走
     * runOneTime，不需要这种 clone 隔离）。
     *
     * 历史上这里曾通过 `outputType=PROMPT_HOOK_OUTPUT_SCHEMA` 让 SDK 在 OpenAI
     * 网关上把 schema 翻译成 `response_format=json_schema`，强约束模型输出。
     * 但很多模型 / 网关（deepseek、Anthropic、自建网关）并不支持该协议，
     * 模型仍会按 markdown 习惯吐 ```json ...``` 代码块包裹，触发 SDK 在
     * `getSchemaAndParserFromInputType` 阶段抛 `Invalid output type`。
     *
     * 现在统一走 text 输出，由 `parsePromptHookResponse` 在 service 这一侧
     * 解析（已支持裸 JSON / markdown 包裹 / 文本嵌入三态）。Schema 强约束
     * 的能力由 prompt 本身（buildStopConditionPrompt）承担——它已经显式要求
     * 模型输出符合三态契约的 JSON。
     */
    private runWithHistory;
    /**
     * 构建发送给 LLM 的用户消息
     *
     * 如果 prompt 中包含 $ARGUMENTS 占位符，则替换它；
     * 否则将 arguments JSON 追加到 prompt 末尾。
     *
     * 注意：Stop/SubagentStop 事件的对话历史通过 context: session 传入，
     * 不再需要手动拼接 history 文本。
     */
    private buildUserMessage;
    /**
     * 基于 baseAgent 派生一个用于 Stop/SubagentStop 评估的 evaluator agent。
     *
     * 不复用原 agent 实例的原因：
     *   - SDK 内部会把 `model` 等字段惰性绑定到 agent 单例，并发调用时
     *     如果直接修改 baseAgent.model 会有 race；
     *   - SDK 的 RunState 与 runner.run 接受任何 Agent 实例，clone 不会破坏
     *     上下文继承（state._context 由调用侧传入，与 agent 解耦）。
     *
     * 复制的字段集合参考 `prompt-suggestion-service.ts:createSilentAgent`。
     * tools 必为空（INTERNAL_GENERATOR_AGENTS 约束）。
     *
     * 不再附加 `outputType` schema：见 `runWithHistory` 头部说明，由 service
     * 自己解析裸文本，能兼容更多网关。
     */
    private cloneEvaluator;
}
