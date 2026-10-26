/**
 * Agent Home 专属表面。WorkBuddy / Zed `--acp` 不在这里。
 *
 * 判据分两层（#125667 决策 + 2026-09-22 入口判据收紧）：
 * - **宿主 / 形态否决**（优先，判错方向只能更严）：WorkBuddy Desktop、未知显式宿主、
 *   非 PWA ACP（`acp && !webUiAcp`）、**无人值守入口**（`-p` print / SDK stream-json）。
 * - **会话级放行**：解析出真实会话（含 id）且不在否决面里的，还要求**入口是 Web UI**
 *   （`webUiAcp`：本进程里这条会话由 Web UI 连接拉起，且最近一次人工输入不是从别的界面发的）、
 *   **daemon 托管的 headless job worker**（Web UI 派发 / 恢复的会话就是这种形态，走 HTTP 而不是
 *   ACP，永远拿不到 `webUiAcp`，见 `CODEBUDDY_JOB_HEADLESS`）或**带 Agent Home 身份**
 *   （同事 job worker 的 `CODEBUDDY_JOB_ID`）。TUI / CLI 里的对话不算表面 —— 同一个 HOME
 *   开着开关，终端里 `cbc` 起的会话、以及在 Web UI 聊过后回到终端继续的轮次，既不被注入
 *   房间花名册，也拿不到自治工具。
 *   畸形 hint（`{context:{}}` / `{options: undefined}` 之类解析不出会话）不算会话级，退回进程级。
 * - **进程级**（无 hint）：保持原信号 —— 同事 job worker（CODEBUDDY_JOB_ID）或 `--serve` 宿主。
 *
 * 即使 ~/.codebuddy/agent-home 里已有房间/频道，宿主否决也优先：不能把
 * MessageColleague / SpeakInChannel 露给 WorkBuddy、IDE ACP 或无人值守入口。
 */
interface SessionLike {
    id?: string;
    options?: {
        acp?: boolean;
        webUiAcp?: boolean;
        lastHumanInputSurface?: 'web-ui' | 'other';
        print?: boolean;
        inputFormat?: string;
    };
}
/**
 * isEnabled 有的走 `{ runContext: { context } }`，有的直接塞 RunContext。
 * 自治工具的闸门（agent-home-tool-gate）也用它取会话，勿另写一份。
 */
export declare function sessionFromToolEnabledArgs(args?: unknown): SessionLike | undefined;
/**
 * env 总闸。HTTP 目录在 env 未设时还看 settings；
 * 工具 / interceptor / inbox / wake 走 isAgentHomeSurface（env ∧ 表面）。
 */
export declare function isAgentHomeFeatureEnabled(): boolean;
/**
 * 同事 job 是 Agent Home 频道/1:1，不是 Agent Teams。
 * TeamCreate / SendMessage 留着，模型会拿来「演示 @」，和频道 @ 不是一回事。
 */
export declare function isAgentHomeJobBlockingAgentTeams(): boolean;
/** isEnabled 没挡住时（旧会话还握着工具）execute 也要拒，并指向 SpeakInChannel。 */
export declare function agentHomeAgentTeamsBlockedMessage(): string;
/** 功能开着，并且当前是 Agent Home 表面。 */
export declare function isAgentHomeSurface(hint?: unknown): boolean;
/**
 * 会话级：宿主 / 形态否决（WB Desktop / 未知显式宿主 / 非 PWA ACP / 无人值守入口）
 * + **入口判据**（Web UI 拉起 / 同事 job 身份）+ 产品开关；无 hint 的进程级消费者
 * 仍只看 job / --serve host。
 *
 * 非 PWA ACP：`acp && !webUiAcp` 关，即使连的是 --serve。
 *
 * 无人值守入口：`-p`（print）与 SDK stream-json 关——它们不是"用户在场的会话"，
 * 却会履行建人 / 建频道 / 以同事身份发言这些有对外副作用的动作。
 *
 * 入口判据（2026-09-22）：真实会话还必须是**Web UI 拉起的**（`webUiAcp`）或
 * **带 Agent Home 身份的**（同事 job worker）。TUI / CLI 里新开的对话不算表面：
 * Web UI 上开着开关，不代表终端里 `cbc` 起的会话要进入 Agent Home。
 *
 * 畸形 hint（`{context:{}}` / `{options: undefined}`）解析不出真实会话 → 退回进程级判定，
 * 不凭"形状像会话"放行。
 *
 * **WorkBuddy 硬排除**（按宿主，不看会话选项）：原先只靠 `session.options.acp`，
 * 而 WB 的 headless/print 入口未必盖 acp，那时只要进程里有 job id 就会被判成
 * "Agent Home 表面"——实测（2026-09-14 抓请求体）WB 宿主 + 同事 job 会拿到
 * CreateChannel/CreateColleague。产品口径是"WB 看不到自治工具"，所以这里按宿主
 * 一刀切；IDE(vscode-acp) 各入口都盖 acp，交给上面那条即可。
 */
export declare function isAgentHomeExclusiveRuntime(hint?: unknown): boolean;
/**
 * 宿主是否可能是 Agent Home 的 Web 面（进程级）：显式 `CODEBUDDY_HOST=web-ui`，
 * 或**没有**显式宿主信号时 argv 回退到 `--serve`（CBC Web UI 的真实形态：它不设该 env）。
 *
 * 为什么不能裸判 `getHostName() === 'web-ui'`：`detectHost()` 对**未识别**的显式宿主值
 * 会继续扫 argv —— 而 WB 的进程恰好都带 `--serve`，一次宿主信号改名/丢失
 * （如 sidecar 的 hostId 落回 'workbuddy-server'）就会静默落进"放行档"，
 * 工具面 / 生命周期 / 收件箱投递 / HTTP 面一起打开（2026-09-14 漏口同型）。
 * 对未知显式宿主一律按"不是 Web UI"处理：判错方向只能是更严，不能更宽。
 *
 * ⚠️ 只给**工具面**用（要求 --serve 指纹没错：TUI 主对话不该拿自治工具）。
 * HTTP 面别用它——TUI 进程也内嵌 Web UI，见 isAgentHomeHttpHostAllowed。
 */
export declare function isAgentHomeWebUiHost(): boolean;
/**
 * **主 Agent 邮箱消费者**的进程闸：比自治工具面（isAgentHomeSurface）宽一档。
 *
 * 这里管的是「进程要不要起消费者」—— 要起：同一进程可能同时服务**内嵌 Web UI**
 * （浏览器里打开的那个端口，其会话是 Agent Home 表面），同事 job 的宿主也可能就是它。
 * 「投给哪条会话」是另一层：会话级入口判据（isAgentHomeSurface，2026-09-22）——
 * 终端 / CLI 里新开的对话**不是** Agent Home 主对话，信留在盘上等 Web UI 会话来取。
 * （历史：这条闸原为「TUI 里对话时同事回报也能送达」而放宽，该口径已被入口判据取代；
 * 收窄的是会话级投递，不是进程级消费。）
 *
 * 仍硬排除：WorkBuddy 宿主、未知显式宿主、IDE 的 ACP 会话（vscode-acp）。
 */
export declare function isAgentHomeMainInboxHost(): boolean;
/**
 * **自治循环**（唤醒经纪 drain + 轮次看门狗 sweep）的宿主闸：与主邮箱同档——
 * 任何合法宿主都该跑自愈。不能用工具面的 isAgentHomeSurface（按会话入口判：
 * Web UI 拉起 / 同事 job）管 housekeeping：工具面防的是"把自治工具暴露给模型"，
 * 看门狗不暴露任何东西。
 * 实测纯 TUI 用频道时协调者心跳停摆 16 小时无人接管（与主邮箱当年
 * "TUI 不投信 8 小时"同型——同一个错误判据咬了两条循环）。
 * 多进程单例不在门禁里解决——协调者租约（agent-home-coordinator）负责；
 * "开关关闭 = 零副作用"由 arm 纪律（agent-home-runtime-arm）负责，也不在门禁里。
 */
export declare function isAgentHomeAutonomyHost(): boolean;
/**
 * HTTP 面（`/api/v1/agent-home/*`）的宿主判据：只按**明确的非 Web UI 宿主**拒绝。
 *
 * 为什么不能复用 `isAgentHomeWebUiHost()`（要求 --serve 指纹）：**TUI 进程也在内嵌服务
 * Web UI**（banner 里的 http://127.0.0.1:<port> 就是它，argv 无 --serve、host='cli'），
 * 要求指纹会把这类用户的频道/看板一起静默关掉（2026-08-16 实发回归）。
 * 拒绝面收窄为：WorkBuddy 宿主（workbuddy-desktop）与未知显式宿主（workbuddy-server 等）——
 * 其余的 host（未设置 / web-ui / cli）都由 gateway 鉴权 + settings 开关各自兜底。
 */
export declare function isAgentHomeHttpHostAllowed(): boolean;
/** 工具 execute：不在表面上时的拒绝文案。在表面上返回 undefined。 */
export declare function agentHomeToolUnavailableMessage(hint: unknown, product: 'channel' | 'room'): string | undefined;
export {};
