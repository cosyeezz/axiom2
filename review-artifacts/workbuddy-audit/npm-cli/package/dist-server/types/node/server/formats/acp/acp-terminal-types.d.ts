import type { TerminalExitStatus as AcpV2TerminalExitStatus, TerminalOutput as AcpV2TerminalOutput, TerminalOutputChunk as AcpV2TerminalOutputChunk, TerminalUpdate as AcpV2TerminalUpdate } from '@agentclientprotocol/sdk/experimental/v2';
import type { AcpTerminalEndReason } from '../../../../vendor/cbc-shared/node/index.js';
import type { AcpConnectionProfile, ClientCapabilities } from './acp-protocol';
/**
 * ACP v2 terminal-output 的报文类型与构造器。
 *
 * 对应 RFD https://agentclientprotocol.com/rfds/v2/terminal-output
 * （revision history 只有 2026-07-14 "Initial draft"，尚未定稿）。
 *
 * 报文字段直接复用 SDK v2 类型；本文件只补 `sessionUpdate` discriminant、构造器和
 * v1-core -> v2-boundary 的严格投影。内部 v1 `SessionUpdate` union 没有这些 v2 事件，
 * 所以发送端仍需在唯一的 v1 兼容边界做类型转换，但不能因此放松字段校验。
 *
 * ⚠️ 不要与 v1 的 client-owned terminal 混用。同目录的
 * `acp-terminal-capability-registry.ts` 管理的是 v1 终端——由客户端经
 * `terminal/create` 创建、agent 可通过 `terminal/*` 控制的资源，服务于
 * `acp-tool-interceptor`。本文件描述的是 v2 的 **agent 拥有、客户端只读展示** 的流。
 * 两者 wire shape 相同而所有权语义相反，RFD 用 MUST NOT 明令禁止仅凭 wire shape
 * 做通用转换。
 *
 * TODO(acp-v2): CBC 内核整体升到 protocolVersion 2 后删除 v1 兼容发送的强转；届时
 * `clientSupportsTerminalOutput` 门禁也一并删除（v2 的 terminal output 不需要能力协商）。
 */
export type AcpTerminalExitStatus = AcpV2TerminalExitStatus;
export type AcpTerminalOutput = AcpV2TerminalOutput;
export type AcpTerminalOutputChunk = AcpV2TerminalOutputChunk & {
    sessionUpdate: 'terminal_output_chunk';
};
/**
 * 终端为什么结束。
 *
 * **为什么需要它**：客户端只有 `exitStatus` 可读，而 `exitCode` 为 null 的来源至少有
 * 五种（用户取消、输出超限被强杀、会话中断、沙箱拦截、退出事件丢失），今天全部渲染成
 * 同一句「已结束」。最要命的是「退出事件丢失」——一个 `exit 2` 的编译失败，因为终止
 * 事件没到（线上实测约 11%），看起来和用户手动取消的任务一模一样。这些信息 agent 侧
 * 全都有（`terminalEvidence` / `exitStatusUnknown` / `stopRequested`），只是从没上过 wire。
 *
 * **为什么用枚举而不是 MCP 那样的自由文本**：MCP Tasks 的 `statusMessage` 是给人和模型
 * 读的一句话，服务端随便写、客户端只负责显示。而我们要驱动的是 UI 的图标与文案分支，
 * 客户端得能 switch —— 自由文本没法本地化，也没法保证两端措辞一致。自由文本的部分
 * 放在 {@link AcpTerminalEndInfo.detail}，只用于 hover 提示，不参与逻辑判断。
 *
 * 取值顺序刻意与 `bash-tool.ts` 里终态判定的分支优先级一致（`stopRequested` 必须排在
 * 退出码之前是 #92382 的血债：kill 之后 exitCode 是 null，先看退出码会把「被停掉」
 * 误报成「正常完成」）。
 */
export type { AcpTerminalEndReason } from '../../../../vendor/cbc-shared/node/index.js';
/**
 * 终端结束信息。挂在 `terminal_update._meta['codebuddy.ai'].end` 上。
 *
 * 为什么走 `_meta` 而不是 `terminal_update` 顶层：RFD 的 `terminal_update` 字段集是
 * 固定的，`_meta` 才是它给实现留的终端级扩展位（"The top-level `_meta` is
 * terminal-scoped"）。加顶层字段虽然 wire 上能过，但属于私自扩展标准报文。
 */
export interface AcpTerminalEndInfo {
    reason: AcpTerminalEndReason;
    /**
     * 可选的人类可读补充，例如「输出超过 4MB」。只用于展示（hover / tooltip），
     * 客户端**不得**据此做逻辑判断——那是 {@link reason} 的职责。
     */
    detail?: string;
}
/**
 * `terminal_update` —— upsert 语义的状态补丁。
 *
 * 补丁三态（RFD 明确要求区分，实现时最容易错的地方）：
 * - 字段省略   → 保持原值不变
 * - 字段为 null → 清除原值
 * - 字段有值   → 替换原值
 *
 * 因此「是否仍在运行」的唯一判据是 `exitStatus` 存不存在，不要另造 status 枚举。
 */
export type AcpTerminalUpdate = AcpV2TerminalUpdate & {
    sessionUpdate: 'terminal_update';
};
export type AcpTerminalSessionUpdateKind = 'terminal_update' | 'terminal_output_chunk';
export declare function readAcpTerminalSessionUpdateKind(value: unknown): AcpTerminalSessionUpdateKind | undefined;
/**
 * Validate and project a v2 terminal upsert without forwarding unknown fields.
 * This is intentionally stricter than a discriminant-only type guard because
 * its input crossed the locally widened v1 SessionUpdate seam.
 */
export declare function projectAcpTerminalUpdate(value: unknown): AcpTerminalUpdate;
/**
 * Validate and project one independently base64-encoded output chunk.
 * Unknown fields are rejected instead of being spread across the ACP boundary.
 */
export declare function projectAcpTerminalOutputChunk(value: unknown): AcpTerminalOutputChunk;
/**
 * v1 compatibility endpoint 的私有能力位：
 * `_meta['codebuddy.ai'].terminalOutput`。
 *
 * 为什么只能放 `_meta`：`initialize` 在 agent 侧走 `zInitializeRequest.parse()` 入站
 * 校验，而 `zClientCapabilities` 是字段固定的 `z.object`，zod 默认剥掉未知键——在
 * clientCapabilities 顶层加字段会被静默丢弃。只有 `_meta`（声明为
 * `z.record(z.string(), z.unknown())`）能让内容原样穿过校验。
 *
 * 也不能复用标准的 `capabilities.terminal` 布尔位：那是 v1 client-owned terminal
 * 的能力声明，一旦置真会让 `acp-tool-interceptor` 接管 Bash，命令改在客户端进程里
 * 执行，语义完全相反。
 *
 * 同类私有能力位先例：`question`、`promptSuggestion`。它只守卫 compatibility
 * endpoint；canonical ACP v2 已把 terminal output 放进标准 SessionUpdate union，
 * 按 RFD 不需要也不允许再依赖这个私有开关。
 */
export declare function clientSupportsTerminalOutput(capabilities: ClientCapabilities | undefined): boolean;
/** Canonical v2 always accepts terminal output; only the v1 endpoint is gated. */
export declare function connectionSupportsTerminalOutput(profile: Readonly<AcpConnectionProfile> | undefined, capabilities: ClientCapabilities | undefined): boolean;
/** Canonical v2 always accepts output chunks; only the v1 endpoint is gated. */
export declare function connectionSupportsTerminalOutputChunk(profile: Readonly<AcpConnectionProfile> | undefined, capabilities: ClientCapabilities | undefined): boolean;
/**
 * 生成 terminalId。
 *
 * 不复用后台任务的 taskId：taskId 是 6 位 `Math.random()` 且不查重、撞了会被
 * `Map.set` 静默覆盖（见 bash-tool.ts 的 generateTaskId），而 RFD 要求 terminalId
 * 在会话内唯一、生命周期内稳定、且绝不复用。
 *
 * 前缀也刻意与 toolCallId 区分：RFD 规定两者是独立命名域，"An Agent may choose
 * the same underlying string for both, but Clients MUST NOT rely on that."
 */
export declare function createTerminalId(): string;
/**
 * 构造一条 `terminal_update`。省略的入参不会出现在报文里——这正是补丁语义
 * 「省略 = 保持不变」所要求的，不要用 `?? null` 之类的兜底把它们填成显式 null。
 */
export declare function buildTerminalUpdate(params: {
    terminalId: string;
    command?: string | null;
    cwd?: string | null;
    output?: AcpTerminalOutput | null;
    exitStatus?: AcpTerminalExitStatus | null;
    _meta?: Record<string, unknown> | null;
}): AcpTerminalUpdate;
export declare function buildTerminalOutputChunk(params: {
    terminalId: string;
    data: string;
    _meta?: Record<string, unknown> | null;
}): AcpTerminalOutputChunk;
