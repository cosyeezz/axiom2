/**
 * MonitorTool —— 后台监视一个事件源，把增量内容主动推回主 agent。
 *
 * 事件源有两种（互斥）：
 * - `command`（issue #74426）：后台跑命令，把其增量输出推回。
 * - `ws`（issue #74436）：连一个 `ws://`/`wss://` URL，把服务端推来的每条消息推回。
 *
 * 背景 / 设计取舍
 * ================
 * 对齐 Claude Code Tools Reference 的 `Monitor` 章节：模型后台监视某个东西，有新内容
 * 时不用主动轮询 `BashOutput`/`TaskOutput`，而是被系统"主动唤醒"看到增量内容。
 *
 * 关键发现（调研已核实）：这不是一个新基础设施，而是把两个已存在的能力接起来：
 * 1. **反应式推送通道**：`BackgroundTaskNotifier`（`enqueueMessage` + 忙闲判断的
 *    `scheduleDrain`）——本工具复用其新增的 `notifyEvent()` 方法（区别于
 *    `notifyCompletion()`：不做 per-task `notified` 幂等，因为"多次增量 tick"本身
 *    就是预期语义，不是重复通知）。
 * 2. **文件 tail 能力**：`BackgroundOutputTailPoller`——本工具复用其新增的 `onChunk`
 *    回调（bash-tool/powershell-tool 不传，行为不变），每次 tick 读到新内容时触发。
 *
 * command 源的拉起复用 `SandboxOrchestrator`（与 BashTool 同一条沙箱优先执行路径），
 * 输出走文件 fd 模式（`prepareBackgroundOutputFiles`），保证子进程/孙进程的
 * stdout/stderr 落盘、父进程不持有写端。
 *
 * ws 源不经过 shell / 沙箱 / 文件 fd（没有进程可言），直接把 socket 消息写进
 * `TruncateBuffer` 并推事件；生命周期仍复用同一个 `BackgroundTask` 契约，
 * 因此 `TaskStop` / `TaskOutput` / `TaskList` 全部零改动可用
 * （已核实 `TaskOutput.executeBackgroundShellTask` 只读 stdout/stderr buffer，
 * 不依赖 `outputFilePath`，所以纯内存的 ws 任务能正常被查询）。
 *
 * 与 BashTool `run_in_background` 的关键区别：
 * - BashTool 的通知只在任务**终态**（completed/failed/killed）时推送一次。
 * - MonitorTool 在任务**运行期间**持续推送增量 `<monitor-event>`，任务终态时改推一条
 *   status=done 的收尾事件。
 *
 * 增量内容不直接推给模型，先过 `MonitorEventGate`（monitor-event-gate.ts，issue #144413）：
 * 合并、截断、限流、刷屏熔断，参数与 CC 一致。**command 与 ws 的事件粒度刻意不同**：
 * command 模式 200ms 内的输出合并成一个事件；ws 模式一条消息 = 一个事件、即使消息跨多行
 * 也不拆，因为消息边界是 WebSocket 的协议语义，合并会破坏它。
 *
 * 停止机制：复用 `TaskStopTool` / `ToolManager.killBackgroundTask` 现有的后台任务
 * 终止路径——本工具注册的 task 与 bash-tool 的 task 走同一个 `BackgroundTask` 契约，
 * `TaskStop` 无需任何改动即可停止一个 Monitor（两种事件源都是）。
 *
 * 开关：默认开启（cbc-cli 场景不需要任何额外配置）。理由见 issue #74426 的"三次审计
 * 修正"结论——WorkBuddy 侧 `mode-tools-config.ts` 已有独立生效的工具白名单天然隔离，
 * agent-cli 侧不需要再叠加一道默认关闭的环境变量；`CODEBUDDY_MONITOR_ENABLED=false`
 * 仍可显式关闭（与 ReportFindings/PushNotification 同档）。
 *
 * ws 源的安全边界（issue #74436，务必理解后再改动）
 * ================================================
 * 出站连接的闸门是 **`execute()` 内每次调用都跑的 `checkWsNetworkPolicy`**，
 * 不是审批弹窗。审批可以被用户的"本会话不再询问"缓存跳过，但网络策略检查不会被跳过，
 * 所以私有地址 / cloud metadata / 有序网络 deny 规则命中的主机在任何情况下都连不上。
 * **不要把网络策略检查挪到 `needsApproval` 里**，那样会被审批缓存绕过。
 *
 * 已知不对齐 CC 的两项（有意为之，见 monitor-ws-network-policy.ts 实现详述）：
 * 不做 DNS 解析（与 WebFetch 现状一致）；无 `allowManagedDomainsOnly` 概念（本仓库不存在该配置）。
 * 另：CC 要求 ws 审批不提供"同 host 免询问"选项，我们目前提供 —— 这需要改动全局审批
 * 服务（影响所有工具），风险面与本功能不成比例，故本轮不做；相关的既有缺陷
 * （`ToolAlwaysApprovalServiceImpl.resolveApprovalRules` 落裸 `[{ toolName }]` 规则，
 * 叠加 Phase 2 早于 Phase 3 安全检查返回）已单独立项跟踪。
 */
import { Session } from '../../vendor/cbc-core/node/index.js';
import { FunctionCallItem, ToolArg, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { BackgroundTaskNotifier } from '../agent-task/agent-task-protocol';
import { BashSandboxManager } from '../bash-sandbox/bash-sandbox-protocol';
import { type SandboxOrchestrator as ISandboxOrchestrator, type SandboxPermissionGateway as ISandboxPermissionGateway } from '../permission';
import { type SandboxCenterIpcClient as ISandboxCenterIpcClient } from '../sensitive-content/sandbox-center-ipc-client-protocol';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
/**
 * timeout_ms 的默认值 / 上下限，对齐 Claude Code 默认的有界模式（`tengu_breezy_crescent`，
 * 2.1.296 实测）：默认 5 分钟、上限 30 分钟、下限 1 秒，schema 中不提供 `persistent`。
 * CC 在单次 print / diskless 场景把上限再收紧到 10 分钟，我们没有对应的宿主区分，统一 30 分钟。
 *
 * **不存在永不停止的 watch**（issue #144413）。每条 `<monitor-event>` 都会在主 agent
 * 空闲时起一轮完整上下文的模型调用，watch 活多久就是成本上限：线上一个 `persistent=true`
 * 的 `yarn dev` watch 在用户离开后每分钟唤醒一次、跑了 9 小时，消耗 2.1 亿 prompt token，
 * 最后靠进程内存打满才停。因此移除了 `persistent`（CC 只在关闭有界模式的旧路径上保留它）；
 * 到期后模型会收到收尾事件，仍需要就自己再开一个。
 */
export declare const DEFAULT_MONITOR_TIMEOUT_MS: number;
export declare const MIN_MONITOR_TIMEOUT_MS = 1000;
export declare const MAX_MONITOR_TIMEOUT_MS: number;
/**
 * `command` 与 `ws` 互斥。
 *
 * **互斥校验刻意放在 `validateRuntimeInput()` 里，不用 `.superRefine()`。** 原因：`superRefine()`
 * 返回的是 `ZodEffects` 而非 `ZodObject`，而 SDK 的 `ToolExecuteArgument<TParameters>`
 * 依赖 `TParameters extends ZodObjectLike`（= `ZodObject<any, any>`，见
 * `@openai/agents-core/dist/utils/zodCompat.d.ts`）。一旦退化成 `ZodEffects`，
 * `execute(input)` 的 input 类型会从推断出的对象塌成 `string`，编译期就丢掉类型保护
 * （JSON Schema 侧虽然仍能正确产出 properties，但类型链已断）。
 *
 * 同理也没用 `z.union`：union 产出的 `anyOf` 在部分模型上表达力较差、容易生成两个
 * 字段都带的调用，且同样不是 `ZodObject`。平铺 optional 字段 + 运行时校验，既保住
 * 类型链，也能给模型明确的错误信息。
 */
declare const MonitorParameters: z.ZodObject<{
    command: z.ZodOptional<z.ZodString>;
    ws: z.ZodOptional<z.ZodObject<{
        url: z.ZodString;
        protocols: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        url: string;
        protocols?: string[] | undefined;
    }, {
        url: string;
        protocols?: string[] | undefined;
    }>>;
    timeout_ms: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    command?: string | undefined;
    ws?: {
        url: string;
        protocols?: string[] | undefined;
    } | undefined;
    timeout_ms?: number | undefined;
}, {
    command?: string | undefined;
    ws?: {
        url: string;
        protocols?: string[] | undefined;
    } | undefined;
    timeout_ms?: number | undefined;
}>;
type MonitorInput = z.infer<typeof MonitorParameters>;
/**
 * 一个事件（command 源 200ms 内的合并输出 / ws 源的一条消息）对应一条 `<monitor-event>`。
 * `suppressedBefore` > 0 时在同一条消息里带上"之前有 N 个事件因限流被丢弃"——与输出合在
 * 一起而不是单独推一条，避免一次投递唤醒模型两次。
 * 导出供单测直接校验 XML 结构，避免测试依赖完整 IoC 装配跑一次真实 execute()。
 */
export declare function buildMonitorEventXml(taskId: string, chunk: string, suppressedBefore?: number): string;
/**
 * 收尾事件的终止原因。ws 源新增 `closed` / `oversized` / `error` 三种（issue #74436）；
 * `flood` 是事件闸门判定持续刷屏后的熔断（issue #144413）。
 */
export type MonitorDoneReason = 'timeout' | 'exit' | 'stopped' | 'closed' | 'oversized' | 'error' | 'flood';
export interface MonitorDoneEventOptions {
    /** 终止原因的补充说明（close code、熔断统计等）。 */
    detail?: string;
    /** 到期时：模型据 timeout 时长与事件数判断要不要重开、要不要调整过滤条件。 */
    timeoutStats?: {
        timeoutMs: number;
        eventCount: number;
    };
    /** 被限流丢弃、且还没随任何事件告知模型的事件数——watch 结束时必须说出来，否则模型会漏看结果。 */
    suppressed?: number;
}
export declare function buildMonitorDoneEventXml(taskId: string, reason: MonitorDoneReason, options?: MonitorDoneEventOptions): string;
export declare class MonitorTool extends BaseTool implements Tool {
    protected readonly sandboxOrchestrator: ISandboxOrchestrator;
    protected readonly sandboxPermissionGateway: ISandboxPermissionGateway;
    protected readonly logger: Logger;
    protected readonly backgroundTaskNotifier: BackgroundTaskNotifier;
    protected readonly bashSandboxManager: BashSandboxManager;
    protected readonly sandboxCenterClient?: ISandboxCenterIpcClient;
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{
        command: z.ZodOptional<z.ZodString>;
        ws: z.ZodOptional<z.ZodObject<{
            url: z.ZodString;
            protocols: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            url: string;
            protocols?: string[] | undefined;
        }, {
            url: string;
            protocols?: string[] | undefined;
        }>>;
        timeout_ms: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        command?: string | undefined;
        ws?: {
            url: string;
            protocols?: string[] | undefined;
        } | undefined;
        timeout_ms?: number | undefined;
    }, {
        command?: string | undefined;
        ws?: {
            url: string;
            protocols?: string[] | undefined;
        } | undefined;
        timeout_ms?: number | undefined;
    }>;
    /**
     * `displayProperties` 是给 command 分支用的（工具调用头只显示命令本身）。
     * ws 分支没有 `command` 字段，若不加 `formatText` 兜底，`displayProperties`
     * 的默认渲染逻辑在找不到该属性时会降级成展示完整参数 JSON（含 `ws.url` 等），
     * 体验上是"未格式化"而非"崩溃"，但既然有专门的格式化钩子就应该用上。
     */
    argumentRenderer: ToolCallArgumentRenderer;
    isEnabled: () => boolean;
    /**
     * 权限投影。
     *
     * **安全关键**：必须按事件源分流。此前只有 command 源时这里硬取 `input.command`，
     * ws-only 调用会投影出 `value: undefined`，导致权限规则匹配拿到空值 —— 那等于
     * 静默放行（规则匹配不到任何东西，也就拦不住任何东西）。新增任何非 command
     * 事件源时都必须同步扩展这里，否则就是开一个权限旁路。
     */
    resolveNeedPermissionArgs(_runContext: RunContext, input: MonitorInput, _callId?: string): ToolArg[];
    /**
     * Auto mode classifier projection：命令本身即为该动作的风险面，与 BashTool 对齐。
     * ws 源投影 URL，理由同 `resolveNeedPermissionArgs` —— 不能给 classifier 空输入，
     * 否则 auto 模式会因「无相关输入」短路放行而不做任何风险评估。
     */
    toAutoClassifierInput(input: unknown): string;
    needsApproval: (runContext: RunContext<Session>, input: unknown) => Promise<boolean>;
    /**
     * 按事件源分派。互斥校验由 `validateRuntimeInput()` 完成，原因见 `MonitorParameters`
     * 上方注释（`superRefine` 会把 schema 退化成 `ZodEffects`，破坏 SDK 的输入类型推断）。
     */
    execute(input: MonitorInput, context: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    /** ws 事件源（issue #74436）：连一个出站 WebSocket，把每条消息当事件推回。 */
    private executeWsSource;
    /** 把 ws 源的终止原因映射成 BackgroundTask 状态 + 收尾事件措辞。 */
    private finishWsByReason;
    /**
     * 解析 timeout_ms，两种事件源共用。
     *
     * 返回值恒 > 0：没有任何输入能得到不设上限的 watch，这是本函数的核心不变式（#144413）。
     * 超出范围的 timeout_ms 夹紧而不是拒绝（CC 对超过 1 小时的值直接拒绝）：拒绝只会让
     * 模型重试，而每次重试都要再付一整个上下文的代价。
     */
    private resolveTimeout;
    /** 两种事件源共用的事件闸门：输出事件（连同之前被丢弃的计数）走 notifier，熔断交给调用方收尾。 */
    private createEventGate;
    /** 记录模型请求的参数与实际生效的截止时间，事后才能判断一个 watch 为什么活了那么久。 */
    private logStarted;
    /** command 事件源（issue #74426）：后台跑命令，把增量输出经事件闸门推回。 */
    private executeCommandSource;
    private closeFdSafely;
    validateRuntimeInput(input: unknown): ToolResult | undefined;
    private invalidParameterResult;
    private generateTaskId;
}
export {};
