/**
 * teammate spawn 的**主模式**解析（issue #127405 · P1）。
 *
 * 团队 agent 要跟随 leader 当前所在的主模式（cli / ptc / minimal / create / 自定义
 * mainAgent 预设）运行：进程型 teammate 走 argv `--agent`（与 agent-view 派发同范式），
 * in-process teammate 走 AgentTask 的显式模式字段。
 *
 * 值来源只认两处，优先级从高到低：
 * 1. leader 会话的**站立键**（`meta.'codebuddy.ai/mainAgent'`，ACP set_agent 与 native
 *    `--agent` 都盖在这里，是唯一权威源）；
 * 2. 进程 `--agent`（leader 的 TUI/--serve 启动参数）—— 与 session-middleware 的
 *    两段式取值同源：`body.agent` → `cliProvider.parseOpts().opts.agent`。
 *
 * 不发明第三处来源：`session.agentName` / telemetry 上的 ptc/minimal 是 leftover，
 * 拿它当模式会让 teammate 在「用户只是 @ 了一下某 agent」后跟着漂。
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
/**
 * 本进程 CLI 快照里的 `--agent`（与 session-middleware 的 `parseOpts().opts.agent` 同源）。
 * 没装 CliRuntimeOptions（headless / 单测）时返回 undefined。
 */
export declare function processAgentNameFromRuntimeOptions(): string | undefined;
/**
 * leader 会话当前**生效**的权限档（`permissionModeSubject` 是唯一事实源）。
 *
 * 内进程 teammate 靠 `{...mainSession.options}` 天然继承到同一档；进程型 teammate 没有这条
 * 继承，spawn 时必须显式带上，否则落默认档（#127405 · P0/R6：需要审批的工具会挂起）。
 *
 * **继承边界**：进程型 teammate 与 in-process teammate 一样继承 leader 当前生效的
 * CLI 权限档，包括 `bypassPermissions` / `dontAsk` / `fullAccess`。用户以 `-y` 进入时
 * leader 的生效档是 bypass；丢掉该档会使 teammate 落回默认档并反复请求审批。
 * 显式 `config.permissionMode` 仍优先于继承值。
 * 排除 `plan`：plan 是"先出方案不动手"的用户态，把 teammate 钉进去会让它无法执行任务；
 * 内进程路径对 plan 有单独处理（Agent tool 的 mode 参数 + plan 锁键），不在这里替它决定。
 */
export declare function leaderPermissionModeForTeammate(mainSession: Pick<Session, 'permissionModeSubject'> | undefined): string | undefined;
/**
 * 解析 teammate 该以哪个主模式跑。返回 undefined = 不注入（跟随 teammate 进程/任务的默认）。
 *
 * 排除 `multitask`：它是协调器旗标（overlay），不是可传播的执行模式 —— 把 teammate
 * 起成 multitask 会让它去当协调者。
 */
export declare function resolveTeammateStandingAgent(mainSession: Pick<Session, 'meta'> | undefined, processAgent?: string): string | undefined;
