/**
 * REPL / code-mode 平台契约(接口级)。
 *
 * 设计见 docs/repl-code-mode/architecture.md。
 * 核心:
 *  - 模型只见 1 个 REPL 工具;内部经 `await import("@wb/...")` 拿桥门面。
 *  - vm 在 agent-cli 的常驻 node worker 里跑(starved,无 seatbelt);能力在 WorkBuddy。
 *  - agent-cli 只认 BridgeHost 三方法 SPI,零业务、不硬编码任何桥。
 */
import { type Session } from '../../../vendor/cbc-core/node/index.js';
import type { RunContext } from '@openai/agents';
import type { REPLCatalog } from '../../agent/code-mode-protocol';
import type { ReplToolCallsDisplay, TodoToolItem, ToolResult } from '../tool-protocol';
import type { BridgeEntry, SearchToolsOptions, ToolDescriptor, ToolSearchHit } from './repl-catalog-protocol';
export type { BridgeEntry, SearchToolsOptions, ToolDescriptor, ToolSearchHit };
/** 模型 import 一个桥时得到的 API 描述符(→ 生成门面 + documentation())。 */
export interface BridgeApiDescriptor {
    /** 桥标识,如 "@wb/browser"。 */
    specifier: string;
    version?: string;
    /** 顶层导出名,如 ["browser", "default"]。门面按此生成。 */
    exports: string[];
    /** 模型面文档(声明式生成或整段字符串);门面的 documentation() 返回它。 */
    documentation: string;
    /** 可选:方法/签名声明,用于更严格的门面/校验;不给则门面走全通 Proxy。 */
    methods?: Array<{
        path: string;
        signature: string;
        doc?: string;
    }>;
}
/** 一次桥方法调用(门面 → broker → BridgeHost)。 */
export interface BridgeInvokeRequest {
    specifier: string;
    /** 方法路径,如 "page.click" / "cua.computer.click"。 */
    method: string;
    args: unknown[];
    /** 归属哪个 REPL 调用(取消/关联)。 */
    callId: string;
    /** 归属哪个会话(WorkBuddy 侧定位浏览器/桌面上下文)。 */
    sessionRef: string;
}
/** broker 收到的一次调用(worker 不知道 sessionRef,由 broker 补)。 */
export type BridgeInvokeOp = Omit<BridgeInvokeRequest, 'sessionRef'>;
/** 多模态图片内容(data URL 或远端 URL)。 */
export interface BridgeImage {
    type: 'image_url';
    image_url: {
        url: string;
    };
}
/** 桥调用结果。截图等作为 value 内联返回({ $media, data } 或 image_url 块),由模型 return 出去渲染。 */
export interface BridgeResult {
    ok: boolean;
    /** 结构化返回值(需可结构化克隆)。 */
    value?: unknown;
    error?: string;
}
/** 单次桥调用的取消/超时控制(随 cell 预算,不写死)。 */
export interface BridgeCallOpts {
    signal?: AbortSignal;
    /** cell 开始于 Auto 时，退出 Auto 后的剩余动作也不能借外层授权放行。 */
    autoModeAtStart?: boolean;
    timeoutMs?: number;
    /**
     * 本次内层工具所属外层 REPL 的 tool-call id（UI function_call_group 的 callId）。
     * 由 worker-manager 从当前 ActiveRun 显式透传，供 Hook 展示归属到正确的外层 REPL。
     * 不走 Session 全局标量：多个外层 REPL 交错时标量会串位/清空（见 #124851 评审）。
     */
    replParentCallId?: string;
}
/**
 * BridgeHost —— agent-cli 只认这三个方法,零业务知识。
 * WorkBuddy 侧实现它;资源布局/加载/结构对 agent-cli 完全透明。
 */
export declare const BridgeHost: unique symbol;
export interface BridgeHost {
    /** 发现:当前可用的 specifier 列表(可选;可懒——先不给 descriptor)。 */
    listBridges(): Promise<string[]>;
    /** 解析:模型 import 时拿描述符;null = 不可用。WorkBuddy 可在此才真正 load 桥代码。 */
    resolveBridge(specifier: string): Promise<BridgeApiDescriptor | null>;
    /** 调用:门面方法落点。agent-cli 在调用前已过权限;此处只执行。opts 携带 cell 的超时/abort。 */
    invokeBridge(req: BridgeInvokeRequest, opts?: BridgeCallOpts): Promise<BridgeResult>;
}
/** 一次 REPL 执行的结果。 */
export interface CellResult {
    ok: boolean;
    result?: unknown;
    /** Worker-side transfer budget truncated the structured return value. */
    resultTruncated?: boolean;
    stdout: string;
    stderr: string;
    images: BridgeImage[];
    error?: string;
    taskPlan?: ReplTaskPlan;
    /** 本次 cell 内部工具调用的展示快照（有界，供 TUI）。 */
    toolCalls?: ReplToolCallsDisplay;
    /**
     * 输出超阈值且完整内容已落盘（OutputSpiller）时的落盘信息。
     *
     * 存在即表示模型面 content 应收敛为 `<persisted-output>` 占位符（与 Bash 截断路径
     * 对齐）：模型拿 2KB 预览 + 文件路径，完整输出留在磁盘供 Read 读取，避免跨轮重复
     * 发送全量结果撑爆上下文。
     */
    persisted?: {
        callId: string;
        filePath: string;
        totalBytes: number;
    };
}
export interface ReplTaskPlan {
    todos: TodoToolItem[];
    acpV2PlanSnapshot?: ToolResult['acpV2PlanSnapshot'];
}
export interface ReplToolCallReply {
    result?: unknown;
    error?: string;
    taskPlan?: ReplTaskPlan;
}
/**
 * 内部调用展示预算（对齐 pi 的 nestedCalls 口径）。
 *
 * - 条数：最多 256 条，超出计入 `omitted`；
 * - 单条参数：8 KB，超出不落参数只记字节数；
 * - 参数总量：32 KB，避免一个 cell 里几十次调用把 session 撑爆。
 */
export declare const REPL_TOOL_CALL_DISPLAY_LIMITS: {
    readonly maxCalls: 256;
    readonly maxArgumentBytesPerCall: number;
    readonly maxArgumentBytesTotal: number;
    readonly maxErrorChars: 500;
};
/**
 * REPL cell 执行中的进度快照（流式上报用）。
 *
 * duration 一律由消费方用 `Date.now() - startedAt` 算 —— `startedAt` 是 cell 启动的
 * 固定墙钟，保证运行时长单调递增（不像内部子工具各自从 0 计时那样反复重置）。
 */
export interface ReplProgressSnapshot {
    /** cell 启动的墙钟时刻（固定基准）。 */
    startedAt: number;
    /** 截至当前的累积 stdout 快照。 */
    stdout: string;
    /** 截至当前的累积 stderr 快照。 */
    stderr: string;
    /** 最近一次子工具调用标识（如 `Bash` 或 `Bash · sleep 5`）。 */
    lastTool?: string;
}
export interface REPLRunOptions {
    timeoutMs: number;
    signal?: AbortSignal;
    /**
     * cell 执行中的进度回调：每秒一次（对齐 bash 的 startStreamingUpdates），以及每次
     * 收到 worker 的 output / toolCall 消息时即时触发一次。上层据此推 UI 聚合流式。
     */
    onProgress?: (snapshot: ReplProgressSnapshot) => void;
    /**
     * 本次外层 REPL 的 tool-call id（与 UI function_call_group 一致）。worker-manager 存到
     * ActiveRun，并在每次内层 toolCall 时透传给 broker，用于内层 Hook 的展示归属。
     */
    replCallId?: string;
}
/**
 * 每 session 一个常驻 node worker(= cell,状态跨调用存活)的管理者。
 * `run` get-or-spawn worker → post exec → await done。
 */
export declare const REPLWorkerManager: unique symbol;
export interface REPLWorkerManager {
    /**
     * 收 `RunContext<Session>` 而非 `Session`:发现类 broker 方法需要 RunContext 才能拿
     * agent 工具白名单(`getAllowedToolsForAgent`),且 RunContext 无法从 Session 反推。
     * 见 docs/repl-code-mode/mcp-code-mode-design.md §4.3.3 易漏点 ①。
     */
    run(context: RunContext<Session>, code: string, opts: REPLRunOptions): Promise<CellResult>;
    /** 协作取消(hard=true → worker.terminate() 硬杀失控 async)。 */
    abort(session: Session, callId: string, hard?: boolean): void;
    /** session 结束/闲置:拆 worker。 */
    dispose(session: Session): Promise<void>;
}
/**
 * BridgeBroker —— worker 的 resolve / bridgeOp / toolCall / replApi 落点(主线程)。
 *
 * 三条分流:
 *  - 工具调用 `callTool` → 主动 checkPermission → DeferExecuteTool 两条现成路由
 *  - 工具发现 `searchTools` / `describeTool(s)` → ToolSearchService(只读,不过权限)
 *  - 外部桥 `resolve` / `invoke` → BridgeHost
 *
 * 批准在 REPL 工具层(整段 code 批一次);发现类是只读元数据查询,把关的是可见性而非权限。
 */
export declare const REPLBridgeBroker: unique symbol;
export interface REPLBridgeBroker {
    resolve(session: Session, specifier: string): Promise<BridgeApiDescriptor | null>;
    invoke(session: Session, op: BridgeInvokeOp, opts?: BridgeCallOpts): Promise<BridgeResult>;
    /**
     * 工具调用。**主动**跑 `checkPermission` 再执行——REPL 的 toolCall 不经 AgentService,
     * 不主动跑则 deny rules 与命令安全检查全部被绕过。
     * 被拒时返回 `{ error }` 而不 throw(§4.8)。
     */
    callTool(context: RunContext<Session>, toolName: string, params: Record<string, unknown>, opts?: BridgeCallOpts & {
        expectedMcpOwner?: string;
    }): Promise<ReplToolCallReply>;
    /** BM25 检索。发现类方法一律收 RunContext(agent 白名单需要它)。 */
    searchTools(context: RunContext<Session>, query: string | string[], opts?: SearchToolsOptions, snapshot?: REPLCatalog): Promise<ToolSearchHit[]>;
    /** 单个工具完整 schema;未知返回 null（**不做 fuzzy fallback**）。 */
    describeTool(context: RunContext<Session>, name: string, snapshot?: REPLCatalog): Promise<ToolDescriptor | null>;
    /** 精准批量（≤ REPL_DESCRIBE_TOOLS_MAX 条），不是全量拉取。 */
    describeTools(context: RunContext<Session>, names: string[], snapshot?: REPLCatalog): Promise<Record<string, ToolDescriptor | null>>;
    /** 外部桥目录（需 import 后用，与工具发现隔离）。 */
    listBridges(session: Session): Promise<BridgeEntry[]>;
}
/**
 * REPL 桥传输 = 一条**本地 socket / 命名管道**(Unix domain socket / Windows 命名管道),
 * 0600 owner-only + token 授权,零端口。
 *
 * spawn agent-cli 的一方(如 WorkBuddy)通过 env 传入**管道路径** + **授权 token**:
 *   - `CODEBUDDY_REPL_HOST_PIPE_PATH`:mac/linux = Unix domain socket 路径;Windows = 命名管道 `\\.\pipe\...`。
 *     Node `net.connect(path)` 对两者透明,由提供方按平台给正确的 path → agent-cli 代码天然跨平台。
 *   - `CODEBUDDY_REPL_HOST_TOKEN`:随每次请求带上,提供方校验(Windows 命名管道无 Unix peer creds,用 token 通用)。
 *
 * 协议:一次连接一次请求——agent-cli 写 `<json>\n`,读 `<json>\n`。agent-cli 不认提供方身份、不做发现、
 * 不走 MCP 工具。**零端口。** 未配置 = 无桥。
 */
export declare const REPL_HOST_PIPE_ENV = "CODEBUDDY_REPL_HOST_PIPE_PATH";
export declare const REPL_HOST_TOKEN_ENV = "CODEBUDDY_REPL_HOST_TOKEN";
/** REPL 工具入参上限:默认 60s,上限 600s。 */
export declare const REPL_DEFAULT_TIMEOUT_MS = 60000;
export declare const REPL_MAX_TIMEOUT_MS = 600000;
export declare function clampReplTimeout(ms?: number): number;
