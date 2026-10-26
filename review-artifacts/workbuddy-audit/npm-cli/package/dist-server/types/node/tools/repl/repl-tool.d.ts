/**
 * REPLTool —— 模型面唯一入口:写 JS、import WorkBuddy 桥来编排。
 *
 * 见 docs/repl-code-mode/architecture.md。
 * - 暴露面:1 个工具;能力经 `await import("@wb/...")` 桥,不做直连工具、暂不给 tools.*。
 * - 执行委托 REPLWorkerManager(每 session 常驻 kernel = cell,状态跨调用存活)。
 * - 高权限:能触达桥,needsApproval=true;必须投影 code 给 auto 分类器(否则静默放行)。
 * - feature-gate:CODEBUDDY_REPL_ENABLED。
 */
import { Session, type SessionManager as ISessionManager } from '../../../vendor/cbc-core/node/index.js';
import { type FunctionCallItem, ToolArg, ToolNames } from '../../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { ReplCatalogSource } from '../../agent/code-mode-protocol';
import { ToolResultBlobService } from '../../blob-store/tool-result-blob-service';
import { BaseTool } from '../base-tool';
import { type ShellStreamPusherService } from '../shell-stream-pusher';
import { Tool, ToolCallArgumentRenderer, ToolManager, ToolResult } from '../tool-protocol';
import { REPLWorkerManager } from './repl-protocol';
/**
 * `parameters()` 收到的 agent 配置。除产品字段外多一个 CLI 内部注记：
 *
 * `sandboxAgentName` —— 沙箱目录（骨架）按哪个身份收窄。Code Mode 的 agent 实例是
 * **进程级共享**的（`agentManager.get('ptc')` 命中的是同一个对象），schema 在构建期物化时
 * 用合成会话采集，拿不到「这一轮是谁在跑」；继承模式的子代理（Explore 等）就会看到模式
 * 的全量目录。派发侧知道子代理身份，经本字段显式传入（见 AgentManager.sandboxScopedAgentView）。
 * 不是产品配置字段，只为 REPL 的动态 schema 服务。
 */
interface ReplParametersAgentConfig {
    sessionView?: import('../tool-protocol').SessionViewRenderInputs;
    name?: string;
    sandboxAgentName?: string;
}
/**
 * 入参形状。运行时 schema 由 `parameters()` 动态生成（要把骨架目录拼进 code 描述），
 * 这里只声明 `execute` 的入参类型——两处字段必须保持一致。
 */
interface ReplToolInput {
    code: string;
    timeout?: number;
    description?: string;
}
export declare class REPLTool extends BaseTool implements Tool {
    protected readonly logger: Logger;
    protected readonly shellStreamPusher: ShellStreamPusherService;
    protected readonly workers: REPLWorkerManager;
    protected readonly catalogSource: ReplCatalogSource;
    protected readonly sessionManager?: ISessionManager;
    protected readonly toolManager?: ToolManager;
    protected readonly toolResultBlobService?: ToolResultBlobService;
    name: ToolNames;
    readonly promptCacheStability: "volatile";
    description: string;
    /**
     * 动态 schema：把骨架目录注入 `code` 参数描述，让模型写 code 前就知道有哪些工具
     * 及其参数形状（一次写对、不盲写）。ToolManager.get() 在 parameters 是函数时会
     * 调用它并转成 JSON Schema，且把正在构建的 agent 传进来。
     *
     * **异常必须自吞**：ToolManager 对 parameters() 抛错的兜底是把 parameters 置为
     * undefined，那对 REPL 是灾难（没有 code 参数就完全不可用）。所以采集失败一律
     * 降级为"无目录但可用"。
     *
     * `agentConfig.sandboxAgentName`（CLI 内部注记）会把骨架目录按子代理身份收窄 ——
     * 共享模式 agent 实例的 schema 本来分不清「谁在跑」，见该字段的说明。
     */
    parameters: (agentConfig?: ReplParametersAgentConfig) => Promise<z.ZodTypeAny>;
    argumentRenderer: ToolCallArgumentRenderer;
    isEnabled: (args?: unknown) => Promise<boolean>;
    /** 必须 override:REPL 能跑桥(含高权限),auto 模式不能静默放行。投影 code 给分类器。 */
    toAutoClassifierInput(input: unknown): string;
    resolveNeedPermissionArgs(_rc: RunContext, input: unknown): ToolArg[];
    execute(input: ReplToolInput, context?: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    /**
     * details.toolCall.callId 缺失时（部分非交互路径），从 session.history 倒序反查本次 REPL
     * function_call 的 callId——对齐 bash 的 findCallId。拿到与 UI 侧 function_call_group 一致
     * 的 callId，流式进度帧才能就地并入同一条工具结果，而不是在对话流里堆积孤立行（issue #101579）。
     * 用 code 精确匹配，避免命中同一会话里更早的 REPL 调用。
     */
    private findReplCallId;
    /**
     * 推一条聚合流式进度到 UI（复用 bash 的 `function_call_result` + `isStreaming` 模式，
     * 不新增 sessionUpdate 类型）。用外层 REPL tool-call 的 callId + 固定 resultId，
     * use-message-groups 据此就地更新同一条 in_progress 结果；运行时长由固定 startedAt
     * 算，单调递增，天然取代内部子工具那种各自从 0 反复重置的孤立条目。
     */
    private emitStreaming;
    /**
     * 渲染骨架目录。**必须自吞全部异常并返回空串**——见 parameters 的注释。
     *
     * 总闸 `CODEBUDDY_REPL_ENABLED` 关闭时直接短路。`isEnabled` 只把工具从 LLM tools
     * 列表里剔除，管不到这里：`parameters` 是动态函数，ToolManager 构建 agent tools 时
     * **无条件** `await tool.parameters()`（tool-manager.ts:396-404）。不短路的话，总闸
     * 关着也会为一个永不暴露给模型的工具跑一遍全量目录采集。
     *
     * 细闸 `CODEBUDDY_REPL_TOOLS_INJECT_CATALOG=0`（或 `false`）可单独关掉目录注入（工具仍
     * 预加载，只是模型不提前知情，退化为纯渐进披露）。默认开启。
     *
     * 另有 `CODEBUDDY_REPL_TOOLS_INJECT_BUILTIN` 控制**内置工具**是否加载到 REPL
     * （PTC/Minimal 默认开，其余模式默认关；`1`/`0` 强开强关）。控制点在
     * ReplCatalogSource.collect（关闭时 catalog.builtin 为空，骨架目录与 sandbox
     * 注入同时不含内置工具），不在本方法。
     */
    private renderSkeleton;
    /**
     * Code Mode 对齐标准模式的技能注入：标准模式的 `<available_skills>` 目录长在
     * Skill 工具描述里；Code Mode 模型面只有 REPL、骨架每行摘要只截 80 字符，
     * 目录会整体丢失。这里把 ToolManager 渲染的完整 Skill 描述（同一份字符预算 /
     * skillOverrides 逻辑）附到 code 参数描述末尾，token 成本与标准模式等价。
     *
     * 与 catalog.collect 分开：骨架摘要每行只截 80 字符，技能列表会丢掉。
     * 即使当前会话不是 Code Mode（正在 freeze ptc agent），只要
     * specForReplParameters 认成 PTC/Minimal，也要把完整 Skill 描述打进去。
     */
    private renderSkillCatalogSection;
    /** ACP 在 ALS 外 getCurrent 会抛；不能让整个 parameters() 失败。 */
    private currentSessionSafe;
    /**
     * ToolManager ↔ REPL 循环依赖时 @Optional 注入会是 undefined。
     * parameters() 在所有组件装配之后才跑，这时再懒取一次。
     */
    private resolveToolManager;
    /**
     * 完成态工具结果。
     * - `content`：模型面结构化 JSON（`buildReplToolContent`，含 result/stdout/stderr[/images]）。
     *   输出超阈值且已落盘时收敛为 `<persisted-output>` 占位符（2KB 预览 + 文件路径），
     *   与 Bash 截断路径对齐——完整内容留在磁盘供 Read，避免跨轮重复发送全量结果。
     * - `renderer.value`：人面展示。**不再显示 "ok"**——改为「耗时置顶 + 执行详情」：
     *   耗时用 `formatTurnDuration`（"50s" / "1m 05s"，无 "ago"）置于首行且始终可见
     *   （不被折叠吃掉）；执行详情（`buildReplDisplayText`）在下方，超 DEFAULT_DISPLAY_ROWS
     *   自动折叠，`ctrl+o` 展开完整详情——与 bash 的结果行体验一致。
     */
    private toToolResult;
    /**
     * REPL 输出超阈值且完整内容已落盘时，把模型面 content 换成 `<persisted-output>` 占位符。
     * 与 Bash buildForegroundResult 的 externalizeFromSpillFile 路径对齐；占位失败
     * （service 缺失/异常）时保留截断文本兜底。
     */
    private externalizeReplOutput;
}
export {};
