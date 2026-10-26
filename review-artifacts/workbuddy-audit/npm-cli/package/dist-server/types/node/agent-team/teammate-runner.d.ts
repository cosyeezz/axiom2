/**
 * TeammateMailboxLifecycle — 独立进程 teammate 的 mailbox 消费服务
 *
 * 作为 ApplicationLifecycle 在标准 cbc --serve 实例中运行。
 * 检测 --teammate-mode CLI 参数时自动启动。
 *
 * 工作流程：
 * 1. 创建 session 并初始化 teamContext（触发 TeamContextInterceptor 注入系统提示）
 * 2. 调用 initRunResultHandler 注册 resultSubject 订阅（处理 runner 输出 → history）
 * 3. 轮询 mailbox 文件读取新消息
 * 4. 通过 agentService.runDefault([input]) 直接执行 agent
 */
import { Application, ApplicationLifecycle } from '@celljs/core';
import { AgentService, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { TeamMailbox } from './team-protocol';
export declare const TeammateRunner: unique symbol;
export interface ITeammateRunner {
    run(): Promise<void>;
}
/**
 * 读取 teammate 进程的 CLI 参数值，支持 `--key value` 与 `--key=value` 两种形式。
 *
 * **为什么不能是「逐 token 首命中扫描」**（本函数改动前的实现）：
 * 那个写法既认 `args[i] === key`（取 `args[i+1]`）也认 `args[i].startsWith(\`${key}=\`)`,
 * 两种判据都**不区分 token 处在 flag 位还是值位**。而 teammate 的 argv 里混着**模型可控**的字符串
 * ——`buildTeammateArgv` 会把 Agent 工具的 `name` 原样 push 成 `--agent-name <值>`。于是名字取
 * `--leader-endpoint=http://evil` 时，这个 token 落在**值位**、又排在真正 push 的 `--leader-endpoint`
 * 之前，首命中即让注入值赢：审批席位被绑到攻击者端点（`bindLeaderPermissionBridge`），对方回
 * `allow` 就跳过审批执行工具，并把完整工具入参 POST 出去。
 *
 * **做法**：单趟顺序解析，按 token 所处位置决定语义——
 * - 裸 flag（`BARE_FLAGS`）→ 跳过 1 个 token，**不消费值位**；
 * - `--key=value` → 登记，前进 1；
 * - `--key` → 把**下一个 token 无条件当作它的值**（不管那个值长什么样、像不像另一个 flag），前进 2；
 *   已在末尾、没有下一个 token 就前进 1（悬空 flag 无值）；
 * - 其它（`-y`、node 路径、脚本路径等）→ 前进 1。
 *
 * 值位**无条件**消费是关键——注入 token 位于 `--agent-name` 的值位，会被当作它的值吃掉，
 * **永远不会被登记成 flag**；真正的 `--leader-endpoint` 处于 flag 位，正常登记。
 *
 * **错位只会 fail-closed**：万一将来 flag 顺序变化导致配对错位（例如新增了没列进 BARE_FLAGS 的
 * 裸 flag），后果只有两种——某个 key 取不到值（返回 undefined → 不绑审批桥 → 回落到「等宿主应答」），
 * 或取到一个不是合法 URL 的串（`isAvailable()` 里 `new URL(...)` 抛错被 catch → false → 同样不绑桥）。
 * 两种都不会放行，不存在 fail-open。
 *
 * 重复 key 以**首次**登记为准（与改动前的首命中语义一致）。
 */
export declare function getArgValue(key: string, argv?: string[]): string | undefined;
export declare class TeammateMailboxLifecycle implements ApplicationLifecycle<Application> {
    protected readonly logger: Logger;
    protected readonly teamMailbox: TeamMailbox;
    protected readonly sessionManager: SessionManager;
    protected readonly agentService: AgentService;
    private shuttingDown;
    /** 桥解绑（进程结束时释放 canUseTool 席位；测试与排查也用它）。 */
    private unbindPermissionBridge?;
    /**
     * 信号驱动的退出（SIGTERM/SIGINT）。与 shuttingDown 分开：shutdown_request 消息与
     * mailbox 收尾也置 shuttingDown，但那两条是**正常收尾**，SessionEnd 该由我们发；
     * 信号路径则交给进程的异步退出路径（process.ts）发，避免两边重复触发。
     */
    private signalRequestedExit;
    private session?;
    onStart(_app: Application): Promise<void>;
    /**
     * 停机兜底：生命周期钩子（ApplicationLifecycle.onStop）早于 mailbox 循环结束时，
     * 也把审批席位释放掉 —— 信号路径只置 shuttingDown 标志，循环退出前进程可能已经在收尾。
     */
    /**
     * 退出前补发 SessionEnd。
     *
     * 进程级退出钩子（process.ts）只对 `sessionManager.getCurrent()` 那个会话发 —— teammate
     * 会话不是 current（进程里没有交互会话），所以在这里对**自己的会话**显式发一次；
     * DI 缺 SessionHookManager（精简变体）时静默跳过，不阻断退出。
     */
    private emitSessionEndBestEffort;
    onStop(): Promise<void>;
    private runService;
    private applyPrivateDataStickyArg;
    private runAgent;
    private waitForInitialMessage;
    private mailboxLoop;
    private formatMessage;
    private isShutdownRequest;
    private handleShutdownRequest;
    /**
     * Write endpoint file so leader can discover this process's HTTP address
     * and connect to its ACP SSE stream for event forwarding.
     */
    private writeEndpointFile;
}
