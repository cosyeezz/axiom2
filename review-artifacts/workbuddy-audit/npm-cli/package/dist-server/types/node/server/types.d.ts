/**
 * Contract types for @tencent-ai/agent-cli/server. Shapes follow the
 * references pinned in the design record (decisions E16–E21,
 * docs/cloud-native/agent-cli-server.md): the SessionStore
 * adapter contract, the Sandbox family, and the stream-json event union.
 */
import type { SessionNotification } from '@agentclientprotocol/sdk';
import type { UpdateSessionNotification } from '@agentclientprotocol/sdk/experimental/v2';
import type { AgentPhaseInfo, CanUseTool, CombineEvent, ModsBridge, SessionKey, SteerInputDisposition, SubagentEventReference, SubagentTokenUsageSnapshot, TranscriptStore as SessionStore } from '../../vendor/cbc-core/node/index.js';
import type { AgentInputItem, ResponseStreamEvent, RunStreamEvent } from '../../vendor/cbc-shared/node/index.js';
import type { Command, ProductConfiguration, Skill } from '@genie/product';
import type { UsageByCategory } from '../acp/usage-by-category-calculator';
import type { RunAccount, RunAuth } from '../authentication/run-context';
import type { Message } from '../cli/stream-json-protocol';
import type { FileSystem, InitialFiles } from '../data-fs';
import type { HostElicitation } from '../elicitation/session-elicitation';
import type { ShellEnvironmentPolicy } from '../execution-context/shell-environment-policy';
import type { TaskOutcome } from '../galileo/task-outcome';
import type { QueryHooks } from '../hooks/query-hooks';
import type { HttpProxyProvider } from '../http/http-proxy-protocol';
import type { ServiceProxyProvider } from '../loopback/service-proxy';
import type { PartialMcpDataValue } from '../mcp/mcp-protocol';
import type { ExternalAgentDefinition } from '../product/agent-conversion-utils';
import type { SandboxDriver, SandboxFactory } from '../sandbox/sandbox';
import type { PermissionMode, ReasoningEffortLevel, Settings } from '../settings/settings-protocol';
import type { CodeBuddyError } from './formats/acp/acp-error-model';
import type { SdkMcpToolDefinition } from './sdk-tools';
import type { ToolsPreset } from './tool-presets';
export type { RunAccount, RunAuth } from '../authentication/run-context';
export type { HookCallback, HookCallbackMatcher, HookEvent, HookInput, HookJSONOutput, QueryHooks } from '../hooks/query-hooks';
export type { ToolsOption, ToolsPreset } from './tool-presets';
export type { InitialFiles, FileSystem } from '../data-fs';
export type { ServiceProxyProvider } from '../loopback/service-proxy';
export type { ShellEnvironmentPolicy, ShellEnvironmentPolicyRequest, ShellEnvironmentSet, } from '../execution-context/shell-environment-policy';
export type { CanUseTool, CanUseToolOptions, CanUseToolPermissionResult as PermissionResult, CanUseToolPermissionUpdate as PermissionUpdate, PermissionUpdateDestination } from '../../vendor/cbc-core/node/index.js';
export type { OrphanedExecSettlement, Sandbox, SandboxCapabilities, SandboxDriver, SandboxFactory, SandboxFileStat, SandboxShellResult, } from '../sandbox/sandbox';
export { MAIN_LANE } from '../../vendor/cbc-core/node/index.js';
export type { Lane, LanePointer, SessionKey, TranscriptStore as SessionStore, SessionStoreEntry, SessionSummaryEntry } from '../../vendor/cbc-core/node/index.js';
export interface StartOptions {
    /**
     * Host policy for the runtime's HTTP client (including model requests).
     * Sampled per request, so config changes affect subsequent requests without
     * restarting sessions. Does not modify process.env or global fetch.
     * Omit to retain the CLI's environment/config/OS proxy resolution.
     */
    httpProxy?: HttpProxyProvider;
    /**
     * Address of the service proxy that hook commands, Bash commands and stdio MCP
     * servers reach through `CODEBUDDY_SERVICE_PROXY_URL`, for a Host that serves the
     * proxy itself. A CLI process serves it on its loopback endpoint; the library has
     * none, so without this option those processes start without the variable.
     * Asked each time such a process starts; `undefined` gives none.
     */
    serviceProxy?: ServiceProxyProvider;
    /**
     * Environment the Host gives the processes the Agent starts for a session,
     * after Codex's `shell_environment_policy`. Unlike it, `set` also reaches
     * hook commands, stdio MCP servers the Agent starts for that session alone
     * and teammates that run as separate processes, and it does not take
     * `PATH`: the Host cannot see the `PATH` a shell snapshot captured, so a
     * full value would drop the user's own directories. Directories for shell
     * commands go in `CODEBUDDY_SHELL_PREPEND_PATH`, which the Agent puts in
     * front after the snapshot. Commands that load no snapshot (PowerShell,
     * the sandbox's shell, a residency whose snapshot failed), hook commands
     * and stdio MCP servers find programs on this runtime's own `PATH` as it
     * is when they start. Each residency of a session, from its first run to
     * its close, makes its own shell snapshot with or without this option, as
     * each CLI process does; calls that belong to no session make one for the
     * process when first needed.
     *
     * Asked once when each run of the session starts, as a CLI process takes
     * its environment when it starts. Until the session's next run starts or
     * it closes, every process started for it in this runtime, its subagents'
     * and in-process teammates' included, gets the names that answer gives:
     * tool calls with their risk review, probes, sandbox approval, execution
     * and retries, hook events, server starts and reconnects, teammate
     * processes, and the sandbox rules of a turn or a configuration refresh.
     * A process keeps the environment it started with; work an earlier run
     * started that asks after the next run started, such as a subagent still
     * running or a server reconnecting, gets the next run's answer. A
     * teammate that runs as a separate process keeps the answer it started
     * with and makes its own snapshot. An answer that fails, gives
     * `undefined` or does not come within 60 seconds is not kept, nor is one
     * that comes later: until the next run each of those asks when it needs
     * its environment, once per tool call, hook event, server start or
     * reconnect, teammate process and sandbox rule build, and a failed answer
     * stays failed for the tool call. Before the session's first run they ask
     * the same way. Events that belong to no session do not ask. Teammates in
     * tmux panes do not ask either: a pane does not inherit this process's
     * environment, as with a CLI process.
     *
     * `set` sits above this runtime's own environment, including what a shell
     * snapshot restores, and below the environment an MCP declaration carries
     * and the variables the Agent sets for each process. A hook that lists the
     * variables it allows picks them from the combined view, and settings the
     * Agent reads from the environment when it starts a process, such as
     * `CODEBUDDY_ENV_FILE` and `CODEBUDDY_SHELL_PREPEND_PATH`, are read from it.
     *
     * Names the Agent owns, invalid names and non-string values are dropped
     * with a warning that gives the name; on Windows names compare
     * case-insensitively. A rejection is logged by kind, without its message,
     * and the process starts without the policy; the Host bounds the latency.
     * The Agent copies an answer and logs only entry counts. It holds a run's
     * answer until the session's next run starts or the session closes, or
     * until the run ends when its session could not be opened, and any other
     * only while what asked is in progress. Values reach a process
     * through its environment; command text names them but does not contain
     * them, except the env file and the prepended directories, which the
     * wrapped command carries as it does today. Processes shared by several
     * sessions start without it.
     */
    shellEnvironmentPolicy?: ShellEnvironmentPolicy;
    /**
     * What a turn does when the session asked for the Host's local sandbox and it
     * cannot start, or this platform has none. `'fail'` (default) fails the turn,
     * so a session never runs outside the sandbox it asked for. `'local'` runs the
     * turn on the host without it, as a CLI process does; only for Hosts whose
     * sessions all belong to the user of this machine.
     */
    sandboxUnavailable?: 'fail' | 'local';
    /**
     * Host-owned Product baseline. Replaces bundled Product files and the
     * process Product cache; omitted fields remain absent. Query Product
     * overrides are merged onto this baseline. Omit to use Agent defaults.
     * A host supplying a complete Product on every query can pass `{}`.
     */
    product?: ProductConfiguration;
    /**
     * 进程级环境配置（boot 前 assign 进 process.env），本运行时服务的所有会话
     * 共用。部署域开关与 CODEBUDDY_BASE_URL 等的 typed 席位——与「装载前设
     * 环境变量」同义，且可覆盖装载期 `??=` 预设（夺回控制权语义）。凭据类键
     * （CODEBUDDY_API_KEY / CODEBUDDY_AUTH_TOKEN / CODEBUDDY_SESSION_SKILL_DIRS）
     * 拒绝：凭据只认 query options（auth）与 start({ apiKey })。随会话不同的值
     * 不经环境变量，走有类型的查询选项（product、promptContext、
     * disallowedTools、agentTeams 等）。例外是会话进程读的环境变量：脚本只能
     * 从环境读，这类值由 shellEnvironmentPolicy 按会话给出，不写进进程环境。
     * 值为 undefined 表示从本运行时的环境中移除该变量（凭据类键也可移除）。
     * stop 或启动失败后恢复本次覆盖的环境值；宿主期间主动修改的值保留。
     */
    env?: Readonly<Record<string, string | undefined>>;
    /** Global SessionStore adapter (SDK shape). Durable events append here on settle. */
    sessionStore?: SessionStore;
    /**
     * 空闲会话钝化阈值（毫秒）。宿主忘 close 的现实防护：超过该时长无 run
     * 活动的常驻会话被自动钝化（≡ close：镜像落 store、内核在存释放；listener
     * 存活，任何 verb 从 store 水合重激活）。缺省 30 分钟；0 = 关闭。清扫为
     * 活动搭车触发（无常驻定时器，不阻进程退出）。
     */
    sessionIdleTimeoutMs?: number;
    /** Explicit SessionKey.projectKey. Defaults to the sanitized session cwd. */
    projectKey?: string;
    /**
     * Filesystem for the ~/.codebuddy user-data domains (E19/E26) — just-bash
     * IFileSystem shape, so InMemoryFs / MountableFs compositions plug in
     * as-is. Composition is mounting; there is no mounts field (E27 撤回判例:
     * MountableFs + declining base replicates per-path routing fully —
     * ancestor synthesis included — so the kernel ships no table form).
     *
     * E26 tiering: the process tier is overlay(this fs, in-memory bottom),
     * resolved per path — paths this fs claims (its tree / its mounts) hit it;
     * everything else is absorbed by process memory and evaporates with the
     * process. Pod-disk reachability is therefore exactly what this fs routes,
     * by construction. Omitted entirely → process memory only. Caution: a
     * MountableFs with its DEFAULT base silently absorbs writes outside its
     * mounts — pass a declining base for write fallthrough.
     */
    fs?: FileSystem;
    /** Declarative seed written into `fs` at start (just-bash InitialFiles shape). Requires `fs`. */
    files?: InitialFiles;
    /**
     * 打开哪些盘上 settings 档（Claude Agent SDK `Options.settingSources` 同名，
     * 归位 start——harness 级：不同集群配不同 harness）。缺省（省略/空数组）=
     * none：served 进程不读任何 settings 盘档，配置走 start/query options。
     * 打开后对应档从挂载的 `fs` 读取（settings 读写走 data-fs seam）——宿主
     * 需把 `~/.codebuddy/settings.json`（user）/ 工作区 `.codebuddy`
     * （project/local）挂进 `fs`。bin 的 argv `--setting-sources` 仍然最高优先。
     */
    settingSources?: Array<'user' | 'project' | 'local'>;
}
/**
 * `stop()` drains in-flight work, then disconnects persistence. Supports
 * `await using`; deliberately no synchronous dispose — graceful shutdown is
 * inherently async.
 * Await successful stop before starting a new runtime in the same process.
 */
export interface Server {
    stop(): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
}
export interface ReadSessionOptions {
    /** Workspace used to locate the transcript. Defaults to process.cwd(). */
    cwd?: string;
    /** Explicit store namespace; otherwise derived from the canonical cwd. */
    projectKey?: string;
    /** Defaults to the existing local JSONL store, independent of start(). */
    sessionStore?: SessionStore;
    /** Enumerate direct child transcripts through the store, without loading their messages. */
    includeSubagents?: boolean;
    signal?: AbortSignal;
}
/** Storage-only creation; no Agent runtime or query is started. */
export type CreateSessionOptions = Pick<ReadSessionOptions, 'cwd' | 'projectKey' | 'sessionStore' | 'signal'>;
export interface RewindOptions {
    /** Last retained native message ID in the active history; null clears the branch. */
    to: string | null;
    /** Workspace used to locate the transcript. Defaults to process.cwd(). */
    cwd?: string;
    signal?: AbortSignal;
}
export interface RewindResult {
    sessionId: string;
    messageId: string | null;
}
/** Durable Agent items, including message identities and conversation facts. */
export interface SessionSnapshot {
    /** Persisted standing Agent, independent of current Product defaults. */
    mainAgent?: string;
    sessionId: string;
    cwd: string;
    history: AgentInputItem[];
    /** Store-owned locators. Pass a key to readSession to read that child lazily. */
    subagents?: Array<{
        sessionId: string;
        key: SessionKey;
    }>;
}
/**
 * 自定义 agent 定义（`QueryOptions.agents` 的值形态）——与 CLI `--agents` /
 * SDK `initialize.agents` 同一形状（`prompt`/`description`/`tools`/`disallowedTools`/
 * `model`/`mcpServers`）。
 */
export type AgentDefinition = ExternalAgentDefinition;
/** Agent input or a maintenance operation; maintenance never creates a user turn. */
export type QueryInput = string | unknown[] | {
    readonly type: 'compact' | 'clear';
};
export interface QueryOptions {
    /**
     * Optional identity for this user query: lowercase, unhyphenated UUIDv7.
     * Adopted before any run events as QueryTicket.runId and the kernel request ID.
     * Must agree with IDs in message inputs. Reuse in queued/running/resident or
     * restored history is rejected, not replayed. Not inherited by autonomous turns.
     * Omit to let the Server assign an ID. Not supported for maintenance queries.
     */
    conversationRequestId?: string;
    /**
     * Opaque request metadata, captured for this query. The reserved W3C keys
     * propagate through this request and its children using the turn context.
     * Unknown extensions do not become session settings or arbitrary HTTP headers.
     * `baggage: 'x-agent-intent=ask'` supplies attribution, not permissions.
     * Host baggage and intent mapping are sent only to built-in model endpoints.
     * Members `x-expert-id`, `x-expert-team-task` and `x-moderation-type` map to the
     * platform headers of the same name on built-in model and platform requests.
     * The legacy `codebuddy.ai.mode` extension fills the scene only when baggage does not supply it.
     * As for an ACP prompt, the `codebuddy.ai` extension also sets the session's attribution and
     * telemetry when the query starts (userId, conversationId, locale, expertId, agentRuntime,
     * telemetryClientInfo, isAutomationBackground, promptRequestId, clientSendTime). Baggage members
     * `workbuddy.prompt_request_id` and `workbuddy.client_send_time` supply the last two. Its `mode`
     * only clears the previous expertId for a non-expert prompt; the session keeps no scene.
     */
    _meta?: Record<string, unknown> | null;
    /**
     * Working directory for the session. Defaults to process.cwd().
     * Same name across the reference set: Claude Agent SDK Options.cwd,
     * ACP session/new cwd, flue useSandbox({ cwd }). Cloud hosts pass the
     * sandbox path; activation-scoped (applied on first touch).
     */
    cwd?: string;
    /**
     * 会话主 agent 选择——served 会话的 `--agent` 席位（旧 spawn 链
     * SDK `initialAgent` → headless CLI `--agent` 的进程级语义搬到会话级）。
     * 提供即置换本会话主 agent（内核 mention 席位，逐 run 生效），省略保持
     * 当前。名字必须存在于进程 agent 目录，未知名 fail-loud 拒绝本 query
     * （AgentOptionError）——静默回落默认 agent 即 expert 语义无声丢弃。
     * 名字可命中进程 agent 目录，或本会话经 `agents` 注入的自定义 agent（见下）；
     * 二者皆无则 fail-loud 拒绝本 query。会话档（会话 fs 里的）插件 agent 装载
     * 是独立缺口：issue #108461。
     */
    agent?: string;
    /** Enable/disable the existing Multitask coordinator overlay on the next query. */
    multitask?: boolean;
    /** Enable the host's local sandbox. Changes apply when the session has no background work. */
    sandboxEnabled?: boolean;
    /**
     * Request a PTY for Bash executions, or false for separate stdout/stderr pipes.
     * Omitted preserves the session's current selection and existing CLI defaults.
     * Execution drivers may require pipes; this does not change sandbox permissions.
     */
    usePty?: boolean;
    /**
     * 会话级自定义 agent 定义（#108461 D6，形态对齐 stream-json `initialize.agents`
     * / SDK `--agents`）：名字 → 定义（`prompt`/`description`/`tools`/`model`/
     * `mcpServers`…）。经标准 `convertAgentDefinitionToProductAgent` 转换后仅注入
     * **本会话** agent 目录，可被 `agent` 选为主席位、也可作为 subagent 派发
     * （`asTool`）；不跨会话泄漏、钝化清除。与进程 agent 同名时本会话以注入定义
     * 为准（宿主显式意图）。驻留期间用 reload(sessionId, { agents }) 显式替换。
     */
    agents?: Record<string, AgentDefinition>;
    /**
     * Plugin packages loaded for this session only, in the listed order. Each root is a
     * plugin directory with its manifest under a metadata directory; `id` (`name@marketplace`)
     * is the plugin's identity in this session: it names its commands and replaces an
     * installed plugin with the same id. Nothing is installed and no selection is persisted.
     * Bound when the session's plugins mount at activation; use reload(sessionId, { pluginRoots })
     * to replace the list before the next turn. Omitted loads none.
     */
    pluginRoots?: readonly SessionPluginRoot[];
    /**
     * 会话级出站 A2A 发现源（进程 env `CODEBUDDY_REMOTE_AGENTS_URL` 的会话
     * 席位，#99451 家族）：提供即置换本会话的发现源——该会话的
     * `<available_A2A_agents>` 目录、gate 判定与 discovery 拉取全部按此 URL
     * 解析；同源会话共享目录分区与单飞拉取，进程 env 源及未表态会话不受
     * 影响。`''` = 本会话显式关闭出站 A2A（即使进程 env 配了源）；省略保持
     * 当前；钝化清除。特性开关（CODEBUDDY_A2A_OUTBOUND_ENABLED /
     * ProductFeature.A2AOutbound）仍是进程级 kill-switch，本席位不绕过；宿主
     * 要替会话打开它用 `remoteAgentsEnabled`。
     */
    remoteAgentsUrl?: string;
    /**
     * 宿主对本会话发现源的策略席位，进程 env `CODEBUDDY_A2A_TRUSTED_RESULTS` /
     * `CODEBUDDY_A2A_OUTBOUND_ENABLED` 的会话版，只对会话自己表态的发现源
     * （`remoteAgentsUrl` 已提供）生效：`remoteAgentsTrusted` 声明该源中 Agent 的
     * 返回可信，A2A 工具结果免于防注入检测；`remoteAgentsEnabled` 为本会话打开
     * 出站 A2A 特性开关（与 env 覆盖一样只能打开，false 回落 ProductFeature）。
     * 两项是一个置换单元：任一提供即整体置换（缺省项按 false），都省略保持当前；
     * 钝化清除。
     */
    remoteAgentsTrusted?: boolean;
    remoteAgentsEnabled?: boolean;
    permissionMode?: `${PermissionMode}`;
    /** Mode to restore after Plan when the host enters Plan before mounting the session. */
    permissionModeBeforePlan?: Exclude<`${PermissionMode}`, 'plan'>;
    model?: string;
    /** Session context budget override; null restores the selected model's default. */
    contextWindow?: number | null;
    /**
     * Session-local pre-message compaction override. 0 disables ordinary threshold
     * and cache-expiry compaction; null clears the override, omission preserves it.
     * Model-switch compaction remains mandatory. Not persisted with the session.
     */
    preMessageCompactPct?: 0 | null;
    /** Session response-language override; null restores host settings, omission preserves it. */
    language?: '简体中文' | 'English' | null;
    /**
     * 工具集：数组项 = 内置工具名 string（内核 --tools 文法项，含 Defer/NoDefer
     * 包装）**或 `tool()` 定义**（宿主自定义工具，E25 混合形）；或 preset
     * （SDK `{ type: 'preset', preset }` 同形）——'default' 沿用内核默认工具集合，
     * 由 Product、平台和启用规则筛选；'workbuddy' = desktop craft
     * 白名单扣除 agent-cli 不存在的名字与裁决排除项后的单一集合；清单常量
     * `WORKBUDDY_TOOLS` 已导出，增删自拼数组。`[]` = 禁用全部内置工具（SDK
     * 同语义）；内核默认全集=省略本字段。
     *
     * tool() 项以**裸名**进入模型工具面（写进数组即入白名单），底层装配为
     * 隐式 `custom_tools` 进程内 SDK MCP server（保留名，与 mcpServers 手动
     * 同名条目冲突即响亮失败）；重名防线见 partitionToolsOption。会话内变更
     * tool() 集合（名/描述长度/schema 键集任一变化）触发会话级 MCP 重挂。
     */
    tools?: Array<string | SdkMcpToolDefinition> | ToolsPreset;
    allowedTools?: string[];
    disallowedTools?: string[];
    /**
     * 需要确认的工具规则，文法同 allowedTools；提供即整体替换，省略保持上次。与各设置档的
     * `permissions.ask` 一同在 bypass 之前判定，可信 allow 规则先于它放行。
     */
    askTools?: string[];
    maxTurns?: number;
    /**
     * run 级一次性取消器（SDK `Options.abortController` 同名）：abort 等价于
     * 对本条 query 的 interrupt——排队中则以 'aborted' 直接收尾，运行中则中断
     * 当前 run。与 interrupt(sessionId) verb 语义同源。abort 的 reason 若在
     * `codebuddy.ai/error` 键下带公共错误（CodeBuddyError），本 run 的持久终态
     * 记为该错误而不是 cancelled（宿主替用户中止、且用户需要处理的场景，如账号变化）。
     */
    abortController?: AbortController;
    /**
     * 模型 thinking 配置（SDK 同形），落会话 override 席位（与 /effort、ACP
     * thought_level 同座；per-query 提供即整体置换该维度，省略保持）：
     * disabled=显式关；enabled(+budget_tokens)=开并可设预算；adaptive=开、
     * 预算交给模型自适应（清除固定预算）。
     */
    thinking?: {
        type: 'adaptive';
    } | {
        type: 'enabled';
        budget_tokens?: number;
    } | {
        type: 'disabled';
    };
    /** 推理强度（SDK `EffortLevel` 同值集），会话 override 席位。 */
    effort?: ReasoningEffortLevel | null;
    /** thinking 预算上限（SDK 同名），会话 override 席位，优先于进程 env。 */
    maxThinkingTokens?: number;
    /**
     * 额外可访问目录（SDK 同名，绝对路径）：接内核 `addDir` 通道并入权限
     * 上下文；`settings.permissions.additionalDirectories`（会话档）同席生效。
     */
    additionalDirectories?: string[];
    /**
     * Kernel local transcript (~/.codebuddy JSONL). Defaults to false on this
     * surface (E21) — pods have no consumer for local transcripts; the
     * SessionStore is the durable copy. Pass true to re-enable.
     */
    persistSession?: boolean;
    /**
     * Per-session system prompt (E23): a string replaces the base prompt, a
     * string[] joins into one, and the preset form keeps the built-in default
     * with an optional append. `preset` is an enum reserved for growth;
     * 'default' is the only member today. Applied on the run-scoped agent
     * clone — internal generator agents (compaction, titles) and subagents
     * keep their own prompts.
     */
    systemPrompt?: string | string[] | {
        type: 'preset';
        preset: 'default';
        append?: string;
    };
    /**
     * Per-session template variables for the main agent's system prompt (the
     * served form of `--prompt-vars-file`). They fill keys the CLI does not
     * produce itself; CLI-produced keys and explicit render context still win.
     * Applied to the main-turn prompt and the session plugin persona only.
     */
    promptContext?: Readonly<Record<string, string | number | boolean | null>>;
    /**
     * Per-session Agent Teams switch: TeamCreate, TeamDelete, SendMessage, team
     * spawning by the Agent tool, and the Teams sections of the Agent and
     * TaskList descriptions. Applies to queries that carry `product`; `null`
     * returns to the process setting (`CODEBUDDY_CODE_EXPERIMENTAL_AGENT_TEAMS`).
     */
    agentTeams?: boolean | null;
    /**
     * Per-session AI title switch: `false` skips the title model request that
     * follows the session's prompts. `null` returns to the process setting
     * (`CODEBUDDY_CODE_DISABLE_TERMINAL_TITLE`).
     */
    aiTitle?: boolean | null;
    /** Deliver partial stream_event frames through subscribe (default off). */
    includePartialMessages?: boolean;
    /**
     * Sandbox for the session's side-effect plane. Canonical form is a
     * SandboxFactory — createSandbox({ id: sessionId }) runs once per
     * activation; a bare SandboxDriver is the sugar form. Activation-scoped:
     * binds on the first query that provides it; omission never unloads it.
     */
    sandbox?: SandboxFactory | SandboxDriver;
    /**
     * Session-tier filesystem for the ~/.codebuddy user-data domains. Multi-
     * identity hosts pass the identity-scoped fs here per session (identity
     * mapping stays host-side).
     *
     * E26 path-level overlay: the session chain is
     * `query.fs → start.fs → process memory`, resolved per path — this fs
     * wins for paths it claims (its tree / its mounts), unclaimed paths fall
     * through to the start tier and finally to process memory. Reads fall
     * through on ENOENT; readdir unions across tiers (upper wins per name);
     * writes land in the first tier whose tree claims the path.
     * Activation-scoped like `sandbox`: binds on the first query that
     * provides it; omission never unloads it. For per-path coverage, compose
     * host-side (MountableFs + declining base) — unclaimed paths then fall
     * through to `start.fs` and process memory.
     */
    fs?: FileSystem;
    /**
     * Session-tier settings (W3): for a served session the query is its CLI,
     * so this takes the seat the `--settings` inline JSON holds for a bin
     * process — merged above every disk scope with the same semantics, and
     * `permissions` rules seed the 'session' rule-source buckets. Activation-
     * scoped like `sandbox`/`fs`: the first query that provides it binds it
     * for the residency; omission never unloads. Use reload(sessionId, { settings })
     * to replace it before the next turn without closing the session. `settings.env` is accepted with its native
     * semantics: it applies to process.env — a harness-global plane shared by
     * every session in the process. Use it for process-wide configuration
     * (e.g. the kernel's feature switches), never for per-tenant data.
     */
    settings?: Settings;
    /**
     * Session-scoped MCP servers (E23 P2) — the seat Claude Agent SDK
     * `Options.mcpServers` and ACP `session/new.mcpServers` give session
     * options. Rides the kernel's agent-scoped MCP lane: isolated clients
     * that never enter the process-global registries, merged above same-name
     * global servers for this session only. Entries follow the kernel config
     * union (stdio / sse / http; type inferred from `command` / `url`), and
     * their tools follow the standard MCP defer policy (enabled by default).
     * Deferred tools appear in this session's ToolSearch catalog; use
     * `defer_loading: false` or `alwaysLoad: true` to expose them inline.
     * Omission keeps the current connections; changed configs replace them,
     * and an empty map removes host-provided servers. close() disconnects the
     * isolated clients. Connection failures warn and leave tools unavailable
     * without rejecting the query; failed setup can be retried on a later query.
     * Hosts may supply { type: 'transport', transport: () => Transport }
     * (including async factories) for standard in-process MCP connections, with
     * transparent_proxy and bare-name metadata. SDK instances stay inline and
     * support builtin tools. Agent project definitions cannot fabricate live transport factories.
     * A stdio entry marked `connection_origin: 'environment'` starts when a query
     * runs, inside the session's execution environment (the session sandbox when
     * it is enabled), and serves later queries until the session closes or the
     * sandbox restarts. The first query waits for it before its first model
     * request, up to `mcpFirstPromptWaitMs`; past that the query continues and
     * its tools appear once it connects. It has `mcpConnectTimeoutMs` to connect.
     */
    mcpServers?: PartialMcpDataValue;
    /**
     * How long, in milliseconds, the session's first query waits before its first
     * model request for the `mcpServers` entries marked `connection_origin:
     * 'environment'`; 0 does not wait. It is not part of the MCP setup: a query that
     * only changes it keeps the connections, and the next wait uses the value stated
     * last. Omission keeps the current value; null, like a session that never stated
     * one, uses `CODEBUDDY_FIRST_RUN_MCP_PREWAIT_TIMEOUT_MS` (2 seconds when unset),
     * the wait process MCP servers get. Must be a non-negative safe integer.
     */
    mcpFirstPromptWaitMs?: number | null;
    /**
     * How long, in milliseconds, each `mcpServers` entry marked `connection_origin:
     * 'environment'` has to connect when the session starts it; a server not connected
     * by then fails, its process ends and the query goes on without its tools. It takes
     * the place of the inline connect limit (the entry's own `timeout`, `MCP_TIMEOUT`,
     * 30 seconds). Like `mcpFirstPromptWaitMs` it is not part of the MCP setup: a query
     * that only changes it keeps the connections, and the next connection uses the value
     * stated last. Omission keeps the current value; null, like a session that never
     * stated one, returns to the inline limit. Must be a positive safe integer.
     */
    mcpConnectTimeoutMs?: number | null;
    /**
     * Use only the MCP servers the host supplies for this session (`mcpServers` and the
     * tool() entries of `tools`), as the CLI's `--strict-mcp-config` and SDK
     * `Options.strictMcpConfig` do. MCP servers declared by the session's plugins
     * (enabled plugins and `pluginRoots`) are not connected; their skills, commands,
     * hooks and agents still load. Agents defined by the Product, plugins or the
     * workspace start none of their own `mcpServers`; definitions passed in `agents`
     * keep their inline servers. Bound when the session activates; `reload` replaces
     * it for a resident session.
     */
    strictMcpConfig?: boolean;
    /**
     * Filesystem settings sources allowed for this session, intersected with
     * `start({ settingSources })`. Omitted inherits the process selection; []
     * reads none. Host `settings` remain available. Bound at activation; replace
     * through `reload`, using all three sources to restore the process selection.
     */
    settingSources?: Array<'user' | 'project' | 'local'>;
    /**
     * Product overrides for this query. Input is copied at admission and merged
     * with the runtime's default Product before execution. Plain objects merge
     * by key; arrays/scalars replace. Each run owns its resolved snapshot,
     * including its subagents and background continuations. Later queries may
     * supply different overrides; omission uses defaults, never the previous
     * query's overrides. Nothing is written to the shared Product or session
     * history. Hosts may provide a complete Product through the same field.
     */
    product?: Partial<ProductConfiguration>;
    /**
     * Keep model-facing tool declarations fixed from the first model request
     * until this run ends. Discovery remains live, and invocation checks the
     * current tool and its permissions. Defaults to false; omission keeps the
     * current session setting. Each new run captures a fresh declaration list.
     */
    freezeToolsDuringRun?: boolean;
    /**
     * Run identity for this query（`auth`/`account`/`headers` 三件一个置换
     * 单元）。Per-query OVERRIDE, unlike the activation-scoped mounts: a
     * later query's identity replaces the earlier one so hosts can rotate
     * tokens; omission keeps the last binding. Consumed by run-plane request
     * origins (model calls, web search/fetch, image/video); the process
     * bootstrap login (product sync, billing) is a separate plane and never
     * changes. 字段名对齐内部 auth 模型（AuthSession{account, auth}）；
     * X-Userinfo 由字段组合（base64(JSON{uin, owner_uin, id_source,
     * token_source})），宿主可经 `headers` 同名项压过任何组合结果。
     */
    auth?: RunAuth;
    /** 身份属性面 ≈ Account 瘦版：uid → X-User-Id、enterpriseId → X-Enterprise-Id、idSource → X-Id-Source。 */
    account?: RunAccount;
    /** run-plane 附加 header 扩展口：压过字段组合、让位内部显式配置（absent-only）。 */
    headers?: Record<string, string>;
    /**
     * Host headers for this session's built-in model requests, such as a device risk
     * token. A per-query replacement unit like the run identity: an explicit empty map
     * clears them, omission keeps the last. They join the plugin runtime's internal
     * headers: never sent to custom model endpoints, removed with
     * CODEBUDDY_SKIP_INTERNAL_HEADERS, and held only on the resident session (never in
     * its options, history or store).
     */
    internalModelRequestHeaders?: Readonly<Record<string, string>>;
    /**
     * 权限回调（Claude Agent SDK `canUseTool` 同名同签名）：工具审批与
     * AskUserQuestion 问答（答案经 `updatedInput.answers` 回填）都走这一条。
     * 激活期绑定（同 sandbox/settings：首供绑定驻留期、省略不卸载、置换走
     * 钝化/激活）；子代理经 root scope 沿用主会话绑定。提供即声明
     * askUserQuestion 能力（工具对模型可见）；未提供时该工具不可见，且
     * 非 bypass 模式下的审批档 fail-closed deny（served 进程无人值守不挂死）。
     */
    canUseTool?: CanUseTool;
    /**
     * The Host's elicitation channel, as an ACP connection's `elicitation/create`
     * and `elicitation/complete`. Activation-scoped like `canUseTool`; child work
     * uses the main session's. Host-mediated cards (WeChat Pay confirmation, A2A
     * approval) need it; without it they keep the plugin's or tool's own flow.
     */
    elicitation?: HostElicitation;
    /**
     * In-process hook callbacks, using the SDK event/matcher/callback shape.
     * Provided maps replace the session binding; omission retains it, {} clears it.
     * Child work inherits its originating run's snapshot. Callbacks are never persisted.
     */
    hooks?: QueryHooks;
    /** Host-owned functional hooks bridge. Captured per query; never persisted. */
    mods?: ModsBridge;
}
export type StopReason = 'completed' | 'aborted' | 'error';
export type QueryTerminal = {
    cancelReason?: string;
    finishReason?: string;
    sensitiveInputDecision?: 'sensitive_access_denied' | 'sensitive_approval_timeout' | 'sensitive_protection_failed';
    sensitiveInputMessage?: string;
} & ({
    stopReason: 'error';
    error: CodeBuddyError;
} | {
    stopReason: 'end_turn' | 'cancelled' | 'max_tokens' | 'max_turn_requests' | 'refusal';
    error?: never;
});
export interface QueryResult {
    runId: string;
    stopReason: StopReason;
    assistantText: string;
    /** The same canonical outcome committed to durable history. */
    terminal?: QueryTerminal;
    /** Existing CLI task classification, emitted only by the executing foreground prompt. */
    taskOutcome?: TaskOutcome;
    /** Present when stopReason is 'error': the underlying failure, stringified. */
    errorMessage?: string;
    /** Cumulative session token counters, when supplied by the model runtime. */
    usage?: SubagentTokenUsageSnapshot;
}
/** Carries the run id synchronously — the kernel conversationRequestId, preassigned. */
export interface QueryTicket extends Promise<QueryResult> {
    readonly runId: string;
}
/** Internal recovery receipt: acceptance reuses the original input, without an echo. */
export interface RecoveryTicket extends QueryTicket {
    readonly accepted: Promise<{
        messageId: string;
    }>;
}
export interface SteerOptions {
    /** Only this active query may receive the input; never starts or queues another run. */
    readonly expectedRunId: string;
    /** Cancels admission or withdraws this input while buffered; never interrupts the active query. */
    readonly signal?: AbortSignal;
}
/** A queue receipt. Only consumed messages enter the transcript and subscribe stream. */
export type SteerResult = {
    readonly steered: true;
    readonly runId: string;
    readonly messageIds: readonly string[];
    /** Buffer outcome, not transcript acceptance. Subscribe for insertion of the returned IDs. */
    readonly consumption: Promise<SteerInputDisposition>;
} | {
    readonly steered: false;
    readonly reason: 'idle' | 'stale';
};
/**
 * One subscribe frame: stream-json messages plus foreground run completion. The core variants are
 * conformance-gated against the vendored reference in ./agent-sdk-types; the
 * remaining variants are the CBC extension frames the same wire carries.
 */
export type SessionEvent = (Message | RunStartedEvent | RunCompletedEvent | AgentEvent) & {
    /** Complete Agent item behind a message frame, shared with readSession(). */
    readonly item?: AgentInputItem;
    /** Producer-owned identity. Background and child events retain their original run. */
    readonly origin?: SessionEventOrigin;
};
export interface SessionEventOrigin {
    readonly requestId?: string;
    readonly rootRequestId?: string;
    readonly subagent?: SubagentEventReference;
}
/** Serializable kernel facts. Protocol-specific projection belongs to the host. */
export interface AgentEvent {
    readonly type: 'agent_event';
    readonly session_id: string;
    readonly event: Pick<Extract<CombineEvent, {
        type: 'input';
    }>, 'type' | 'data'> | Pick<Extract<CombineEvent, {
        type: 'compaction';
    }>, 'type' | 'data'> | Pick<Extract<CombineEvent, {
        type: 'subagent_status';
    }>, 'type' | 'data'> | Pick<Extract<CombineEvent, {
        type: 'terminal';
    }>, 'type' | 'data'> | {
        readonly type: 'turn_diff';
        readonly data: import('../tools/file-change-artifact').FileChangeArtifact;
    } | {
        readonly type: 'phase';
        readonly data: AgentPhaseInfo;
    } | {
        readonly type: 'progress';
        readonly data: string | null;
    } | {
        readonly type: 'configuration';
        readonly data: Pick<QueryOptions, 'permissionMode' | 'permissionModeBeforePlan' | 'agent' | 'multitask'>;
    } | {
        readonly type: 'usage';
        readonly data: {
            readonly contextTokens: number;
            readonly modelId?: string;
            /** Settled root-turn snapshots only: conserved 5-category breakdown of contextTokens. */
            readonly usageByCategory?: UsageByCategory;
        };
    } | {
        readonly type: 'catalog';
        readonly data: SessionCatalog;
    } | {
        readonly type: 'title';
        readonly data: string;
    } | {
        readonly type: 'error';
        readonly data: unknown;
    };
    readonly _requestId?: string;
    readonly _meta?: Record<string, unknown> | null;
}
export interface SessionCatalog {
    readonly commands: Array<Pick<Command, 'name' | 'description' | 'argumentHint' | 'tags'>>;
    readonly skills: Array<Pick<Skill, 'name' | 'description' | 'source' | 'userInvocable' | 'disableModelInvocation' | 'pluginInfo'>>;
    readonly skillOverrides?: Settings['skillOverrides'];
}
/** A plugin package a session loads from a directory (QueryOptions.pluginRoots). */
export interface SessionPluginRoot {
    readonly id: string;
    readonly path: string;
}
/** Refresh resident components before the next queued turn (including continuations).
 * Omitted overrides keep the current host inputs; empty objects and empty lists replace them.
 * Files are read through the session's existing filesystem. No model run is started.
 */
export type ReloadOptions = Pick<QueryOptions, 'settings' | 'agents' | 'pluginRoots' | 'strictMcpConfig' | 'settingSources'>;
export interface ReadSessionCatalogOptions extends Pick<QueryOptions, 'cwd' | 'fs' | 'settings' | 'settingSources' | 'product' | 'agents' | 'agent' | 'pluginRoots'> {
    signal?: AbortSignal;
}
/** A user query or automatic continuation has started executing in the session queue. */
export interface RunStartedEvent {
    readonly type: 'run_started';
    readonly session_id: string;
    readonly runId: string;
    readonly source: 'query' | 'continuation';
    readonly _meta?: Record<string, unknown> | null;
}
/** Run settlement, ordered after its messages in each subscription.
 * Background work and the subscription may continue after this event.
 * For user queries the result fields match the QueryTicket's result.
 */
export interface RunCompletedEvent extends QueryResult {
    readonly type: 'run_completed';
    readonly session_id: string;
    readonly _meta?: Record<string, unknown> | null;
}
/** Selects only presentation; query lifecycle and persistence are shared. */
export type SessionOutputFormat = 'openai' | 'messages' | 'acp-v1' | 'acp-v2';
export interface SubscribeOptions<F extends SessionOutputFormat = 'messages'> {
    readonly format: F;
}
/** All SDK stream event variants, with the original object as data (no JSON conversion). */
export interface AgentSdkEvent {
    readonly type: 'agent_sdk';
    readonly parentToolUseId?: string;
    readonly session_id: string;
    readonly data: RunStreamEvent;
    readonly origin?: SessionEventOrigin;
    readonly _meta?: Record<string, unknown> | null;
}
/** Native model facts used by formatters, never stream-json intermediates. */
export interface AgentModelEvent {
    readonly type: 'agent_model';
    readonly parentToolUseId?: string;
    readonly session_id: string;
    readonly data: ResponseStreamEvent;
    readonly origin?: SessionEventOrigin;
    readonly _meta?: Record<string, unknown> | null;
}
export interface AcpSessionEvent<F extends 'acp-v1' | 'acp-v2'> {
    readonly type: 'acp_update';
    readonly notification: F extends 'acp-v1' ? SessionNotification : UpdateSessionNotification;
    readonly item?: AgentInputItem;
    readonly origin?: SessionEventOrigin;
    readonly _meta?: Record<string, unknown> | null;
}
export type NativeSessionEvent = (AgentSdkEvent | AgentEvent | RunStartedEvent | RunCompletedEvent) & {
    readonly origin?: SessionEventOrigin;
};
export type FormattedSessionEvent<F extends SessionOutputFormat = 'messages'> = (F extends 'messages' ? SessionEvent : F extends 'acp-v1' | 'acp-v2' ? AcpSessionEvent<F> | AgentEvent | RunStartedEvent | RunCompletedEvent : NativeSessionEvent) & {
    readonly origin?: SessionEventOrigin;
    readonly item?: AgentInputItem;
};
/** Internal source union. ACP never consumes stream-json messages. */
export type SessionSourceEvent = SessionEvent | AgentSdkEvent | AgentModelEvent;
export type SessionEventListener = (event: SessionEvent) => void | Promise<void>;
export type SessionSubscriptionExit = {
    readonly reason: 'unsubscribed';
} | {
    readonly reason: 'failed';
    readonly error: unknown;
};
/** A bounded, ordered event subscription. It does not slow down the agent loop. */
export interface SessionSubscription {
    /** Stop delivery. Preserves the original `const off = subscribe(...); off()` API. */
    (): void;
    /** Wait for delivery of every event produced before this call. */
    drain(): Promise<void>;
    /** Discard queued events and release the subscriber. Idempotent. */
    unsubscribe(): void;
    /** Resolves on unsubscribe, callback failure, or queue overflow; never rejects. */
    readonly closed: Promise<SessionSubscriptionExit>;
}
/** An already committed configuration change, including its original Settings source. */
export interface ConfigChange {
    source: 'user_settings' | 'project_settings' | 'local_settings' | 'policy_settings' | 'skills';
    filePath?: string;
    cwd?: string;
}
/** Host dependencies for the Agent's ordinary settings.json hooks. */
export interface NotifyConfigChangeOptions extends Pick<QueryOptions, 'fs' | 'settings' | 'product' | 'auth' | 'account' | 'headers'> {
    signal?: AbortSignal;
    environment?: NodeJS.ProcessEnv;
    fetch?: (url: string, init: RequestInit) => Promise<Response>;
}
