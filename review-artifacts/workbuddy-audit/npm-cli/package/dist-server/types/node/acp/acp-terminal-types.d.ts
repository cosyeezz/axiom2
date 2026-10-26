import type { AcpTerminalEndReason } from '../../vendor/cbc-shared/node/index.js';
import type { ClientCapabilities } from './acp-protocol';
/**
 * ACP v2 terminal-output 的报文类型与构造器。
 *
 * 对应 RFD https://agentclientprotocol.com/rfds/v2/terminal-output
 * （revision history 只有 2026-07-14 "Initial draft"，尚未定稿）。
 *
 * 为什么手写而不用 SDK 类型：`@agentclientprotocol/sdk@0.25.0` 的 SessionUpdate
 * union 里没有 `terminal_update`，它只存在于 SDK 1.x 的 `experimental/v2` 导出
 * （那里同时把 protocolVersion 提到 2、删掉了 `tool_call` / `session/load` 等，
 * 不是能单点引入的东西）。仓库已有上 wire 的非标准 sessionUpdate 先例
 * `session_end`（见 acp-timestamp-meta.ts 的 buildAcpSessionEndUpdate），这里沿用
 * 同一种做法：本地宽松声明 + 发送时强转。
 *
 * ⚠️ 不要与 v1 的 client-owned terminal 混用。同目录的
 * `acp-terminal-capability-registry.ts` 管理的是 v1 终端——由客户端经
 * `terminal/create` 创建、agent 可通过 `terminal/*` 控制的资源，服务于
 * `acp-tool-interceptor`。本文件描述的是 v2 的 **agent 拥有、客户端只读展示** 的流。
 * 两者 wire shape 相同而所有权语义相反，RFD 用 MUST NOT 明令禁止仅凭 wire shape
 * 做通用转换。
 *
 * TODO(acp-v2): SDK 补齐 v2 类型且 CBC 整体升到 protocolVersion 2 后，改为直接引用
 * SDK union 并删除本地声明；届时 `clientSupportsTerminalOutput` 门禁也一并删除
 * （v2 里 terminal_update 属标准 union，不需要能力协商）。
 */
/** 终端进程的退出状态。两个字段都可能为 null（非信号退出 / 退出码未知）。 */
export interface AcpTerminalExitStatus {
    exitCode: number | null;
    signal: string | null;
}
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
export type { AcpTerminalEndReason } from '../../vendor/cbc-shared/node/index.js';
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
export interface AcpTerminalUpdate {
    sessionUpdate: 'terminal_update';
    terminalId: string;
    command?: string;
    /** 必须是绝对路径。 */
    cwd?: string;
    /**
     * 权威全量快照（base64 字节），不是增量：RFD 原文 "It replaces all previously
     * stored bytes, and Clients MUST NOT merge or splice bytes from the previous
     * snapshot into it."
     *
     * 快照定基线、chunk 在其上追加（RFD："Later chunks append to the replacement."）。
     * 用途是重放与纠偏，不是常规推送——运行期的增量走 {@link AcpTerminalOutputChunk}。
     */
    output?: {
        data: string;
    };
    exitStatus?: AcpTerminalExitStatus;
    [key: string]: unknown;
}
/**
 * `terminal_output_chunk` —— 运行期的增量追加。
 *
 * 与 {@link AcpTerminalUpdate.output} 的分工是 RFD 明确定义的：快照负责重放/纠偏/
 * 重新同步，chunk 负责高效的实时追加。反复推全量在实时场景下太贵，而纯追加流又
 * 无法重放，两者缺一不可。
 *
 * `data` 是**一个独立 base64 编码的字节块**。客户端必须逐条解码后按到达顺序追加，
 * RFD 原文禁止先拼接编码串再整体解码（"they MUST NOT concatenate the encoded
 * strings and decode them as one value."）——因为块边界没有文本含义，一个块可能
 * 正好切断一个 UTF-8 码点或 ANSI 转义序列，解析状态由客户端跨块保留。
 *
 * ⚠️ 同一个 terminalId 的多条 `terminal_update` / `terminal_output_chunk` 不得放进
 * 同一个 JSON-RPC batch（当顺序影响结果时）：batch 内条目允许任意顺序处理。本仓库
 * 不做 batch，但改动发送链路时要记住这条。
 */
export interface AcpTerminalOutputChunk {
    sessionUpdate: 'terminal_output_chunk';
    terminalId: string;
    /** RFC 4648 base64 编码的字节块。 */
    data: string;
    [key: string]: unknown;
}
/**
 * 客户端能力位：`_meta['codebuddy.ai'].terminalOutput`。
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
 * 同类私有能力位先例：`question`、`promptSuggestion`。未声明的客户端一律不推送，
 * 行为与改造前完全一致。
 */
export declare function clientSupportsTerminalOutput(capabilities: ClientCapabilities | undefined): boolean;
/**
 * 客户端能力位：`_meta['codebuddy.ai'].terminalOutputChunk`。
 *
 * **为什么必须是独立的一位，不能复用 `terminalOutput`**：存量客户端（含全部
 * WorkBuddy）已经声明了 `terminalOutput: true`，但它们的分发逻辑只认识
 * `terminal_update`，而且接收侧没有 zod 校验能把未知 sessionUpdate 拦下——直接开始
 * 推 `terminal_output_chunk` 会让这些客户端收到不认识的报文，落到分发链末尾，
 * 行为不可预期。
 *
 * 拆成两位之后，agent 与客户端可以独立发版：只声明旧位的客户端一个字节都收不到，
 * 行为与改造前完全一致；新位由客户端在**渲染实现完成后**自己翻开。
 *
 * 未声明本位的客户端不做任何降级（例如改推重量级全量快照）——它们本来也不渲染
 * 输出，推过去纯属浪费带宽。
 */
export declare function clientSupportsTerminalOutputChunk(capabilities: ClientCapabilities | undefined): boolean;
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
    command?: string;
    cwd?: string;
    exitStatus?: AcpTerminalExitStatus;
    /** 权威全量快照的原始字节；由本函数负责 base64 编码。 */
    output?: Buffer;
    /** 结束原因，写进终端级 `_meta`。只在带 exitStatus 时有意义。 */
    end?: AcpTerminalEndInfo;
    background?: {
        reason: NonNullable<import('../../vendor/cbc-core/node/index.js').BackgroundTask['backgroundReason']>;
        startedAt: number;
    };
}): AcpTerminalUpdate;
/**
 * 构造一条 `terminal_output_chunk`。入参是**原始字节**，base64 编码在这里做——
 * 让编码只有一个出口，调用方不会误传已经编码过的字符串。
 */
export declare function buildTerminalOutputChunk(terminalId: string, bytes: Buffer): AcpTerminalOutputChunk;
