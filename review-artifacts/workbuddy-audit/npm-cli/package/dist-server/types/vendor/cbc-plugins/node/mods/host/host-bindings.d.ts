import type { EngineInterface, Settings, ToolCheckResult, UiAskOptions } from '../types';
import type { FsAncestor, FsAncestorsRequest, FsEntry, FsStat } from '../types/claude-code';
import type { PluginStoreLocks } from './plugin-store';
/**
 * 一个渲染面。对齐官方 `RenderSurface`。
 *
 * 这套 UI API **不是终端专用**：官方把它做成了面抽象，`session.start` 带
 * `surface`，`$.session.surfaces()` 返回**多个**面，`RenderViewport` 还区分
 * 「terminal 按字符格」与「远端面按代码字体折算」。同一个 mod 的 UI hook 要能
 * 同时服务终端和远端 GUI。
 *
 * 映射到 cbc：`terminal` = Ink TUI，`cbc-webui` = `--serve` 的 CLI Web UI，
 * `desktop` = WorkBuddy Desktop，`vscode` = VS Code 扩展。`web` / `mobile`
 * 保留给未来的浏览器版 / 移动端外壳（官方 mod 已在用这两个名字，类型层要认）。
 */
export type RenderSurface = 'terminal' | 'cbc-webui' | 'desktop' | 'web' | 'mobile' | 'vscode';
/**
 * The surface as a mod reads it: official `RenderSurface` is `terminal | desktop |
 * vscode | mobile`. cbc's Web UI (`cbc-webui`, and the earlier `web`) draws as
 * Claude Code's desktop app does — the desktop element table, docked panes — so a
 * mod's `Elements[e.surface]` or `{ surface: 'desktop' }` matcher reaches it.
 */
export declare function upstreamSurfaceOf<T>(surface: T): T | 'desktop';
/**
 * 宿主注入给 `core` 层的**窄接口**。
 *
 * ## 为什么是接口而不是直接调 agent-cli
 *
 * mods 位于 `cbc-plugins`，而会话、cwd、TUI 输出这些只有宿主知道。反过来 import
 * 宿主会把依赖方向掉个头（也会撞上 cbc-core/shared 的单向依赖卡点）。所以这里只
 * 声明「core 需要宿主回答什么」，由宿主填。
 *
 * ## 每一项都可选，缺省有诚实的退化
 *
 * 官方 mod 不会假设宿主实现了全部能力 —— `agents-md` 就把 `$.telemetry` 包在
 * `Telemetry.quietly()` 里，因为那个 noun 可能根本没被 seat。同理，宿主没接的
 * 能力必须给出**明确的拒绝**而不是静默 `undefined`：前者 mod 能感知并退化，后者
 * 会变成难查的错误值。`createCoreHandler` 因此对未注入的能力回 `{ deny }`。
 */
/**
 * An embedding host's filesystem as the core reads it: `read` answers text, or
 * base64 for `{ as: 'base64' }` (the core turns it into the official `FsBytes`).
 */
export interface HostFs {
    read(path: string, options?: {
        as?: 'text' | 'base64';
    }): Promise<string>;
    write(path: string, text: string): Promise<void>;
    list(path?: string): Promise<readonly FsEntry[]>;
    exists(path: string): Promise<boolean>;
    stat(path: string, options?: {
        resolve?: boolean;
    }): Promise<FsStat>;
    ancestors(request: FsAncestorsRequest): Promise<readonly FsAncestor[]>;
}
export interface HostBindings {
    /** An embedding host owns its filesystem and environment; do not fall through to Node. */
    readonly fs?: HostFs;
    readonly env?: EngineInterface['env'];
    /** 当前会话的工作目录（绝对路径）。`$.session.cwd()` */
    readonly cwd?: () => string;
    /**
     * 项目根（通常是 git 仓库根）。`$.session.root()`
     *
     * `agents-md` 用它判断「这是不是一个 CLAUDE.md 项目」，拿不到会退化成
     * 「不是」，所以返回 undefined 是合法答案，不是错误。
     */
    readonly root?: () => string | undefined | Promise<string | undefined>;
    /** 会话 id。`$.session.id()` */
    readonly sessionId?: () => string | undefined;
    /** Live session runtime lifetime, used to discard session-scoped stores. */
    readonly sessionSignal?: () => AbortSignal | undefined;
    /** 当前模型 id。`$.session.model()` */
    readonly model?: () => string | undefined;
    /** 是否交互式（TUI）。`session.start` 的 `isInteractive` 用。 */
    readonly isInteractive?: () => boolean;
    /** 仓库信息。`$.session.repo()` */
    readonly repo?: () => {
        root: string;
        remote: string | null;
        internal: boolean;
        name: string | null;
    } | undefined | Promise<{
        root: string;
        remote: string | null;
        internal: boolean;
        name: string | null;
    } | undefined>;
    /** 用户已提交的 prompt 数（transcript 中的 user turns）。`$.session.turns()` */
    readonly turns?: () => number | Promise<number>;
    /** Await real compaction; false is a failure, never a successful no-op. */
    readonly compact?: (input: {
        readonly instructions?: string;
    }, signal: AbortSignal) => Promise<boolean>;
    /** 会话消息。`$.session.messages()` */
    /** The conversation's history items (main, or the agent `agentId`'s); undefined: no such agent. */
    readonly messages?: (args: {
        readonly agentId?: string;
    }) => readonly unknown[] | undefined | Promise<readonly unknown[] | undefined>;
    /**
     * 当前渲染面。`$.session.surface()`
     *
     * 没有可渲染的面（`--print` / ACP stdio 这类无界面运行）时回 `null` ——
     * 那是官方 `SessionStartInput.surface: RenderSurface | null` 里的合法取值，
     * mod 据此决定要不要画东西，不是错误。
     */
    readonly surface?: () => RenderSurface | null;
    /** 全部渲染面。`$.session.surfaces()` —— 同一个会话可以同时挂多个。 */
    readonly surfaces?: () => readonly RenderSurface[] | Promise<readonly RenderSurface[]>;
    /** 用量。`$.session.usage()` */
    readonly usage?: (args?: Record<string, unknown>) => unknown | Promise<unknown>;
    /** 中断当前轮次。`$.turn.abort()` */
    readonly abortTurn?: (input: Record<string, unknown>) => void | Promise<void>;
    /** 当前 prompt 文本。`$.prompt.read()` */
    /** `$.prompt.read()`: the box as it stands (official `PromptBox`); a bare string reads as its text. */
    readonly readPrompt?: () => string | {
        text: string;
        cursor: number;
    } | undefined | Promise<string | {
        text: string;
        cursor: number;
    } | undefined>;
    /** Apply the final middleware text to a live surface; receipt is not model completion. */
    readonly fillPrompt?: (input: {
        text: string;
    }, signal: AbortSignal) => Promise<{
        accepted: true;
    }>;
    readonly submitPrompt?: (input: {
        text: string;
    }, signal: AbortSignal) => Promise<{
        accepted: true;
    }>;
    readonly suggestPrompt?: (input: {
        text: string;
    }, signal: AbortSignal) => Promise<{
        accepted: true;
    }>;
    /** 已注册工具。`$.tool.list()` */
    readonly tools?: () => readonly unknown[] | Promise<readonly unknown[]>;
    /**
     * `$.tool.check({ tool, input })` core: the engine's declarative verdict on a call of
     * `tool` with `input`, for the session's mode and rules, before the mode settles an ask.
     *
     * Runs nothing: no tool, no dialog, no classic hook, no classifier. Rejects when no tool
     * has that name. A real call answers `tool.check` with its own verdict (`coreResult`),
     * so this answers a plugin's query alone.
     */
    readonly checkTool?: (args: {
        readonly tool: string;
        readonly input: unknown;
    }, signal: AbortSignal) => Promise<ToolCheckResult>;
    /** 已注册命令。`$.command.list()` */
    readonly commands?: () => readonly unknown[] | Promise<readonly unknown[]>;
    /** 已注册 agent。`$.agent.list()` */
    readonly agents?: () => readonly unknown[] | Promise<readonly unknown[]>;
    /** 配置项。`$.config.list()` */
    readonly configs?: () => readonly unknown[] | Promise<readonly unknown[]>;
    /**
     * 注册一个斜杠命令。`$.command.register(spec)`
     *
     * 未提供时 core 缺省按「名义成功」处理（返回 `{ command: name }`），与
     * `agent.register` 对齐——很多官方 mod 用命令注册作为 `bind()` 的必要前置，
     * 若在 e2e / test harness / 未接命令表的宿主里被 deny，整个 mod 就此空转。
     * 想把命令真正接进 CLI 的宿主实现这里并覆盖 fallback。
     */
    readonly registerCommand?: (spec: Record<string, unknown>, plugin: string) => unknown | Promise<unknown>;
    /** 注册工具。`$.tool.register(spec)`——同 registerCommand，未提供时缺省名义成功。 */
    readonly registerTool?: (spec: Record<string, unknown>, plugin: string) => unknown | Promise<unknown>;
    /**
     * 注销工具。`$.tool.unregister(name)`
     *
     * 与 register 不同，缺 host 时 core 明确拒绝：一个"名义成功"的 unregister
     * 会让 mod 以为清理妥当，实际宿主里工具仍在挂着。
     */
    readonly unregisterTool?: (name: string, plugin?: string) => void | Promise<void>;
    /** 注销斜杠命令。`$.command.unregister(name)`——同 unregisterTool，缺 host 时 deny。 */
    readonly unregisterCommand?: (name: string, plugin?: string) => void | Promise<void>;
    /** Release one plugin's command/tool contributions before replacing its runtime lifetime. */
    readonly releasePlugin?: (plugin: string) => Promise<void>;
    readonly isCommandUnregistered?: (name: string) => boolean;
    /** 注册 agent。`$.agent.register(spec)` */
    readonly registerAgent?: (spec: Record<string, unknown>, plugin: string) => unknown | Promise<unknown>;
    /**
     * 往会话记录/调试流里写一行。`$.ui.log()`
     *
     * `plugin` 是发起本次调用的 mod 名（`origin.plugin`）—— 宿主要把这行落到用户
     * 可见的位置（TUI 消息历史 / Web UI chat view）时需要它来做前缀 / 分组 / 归属。
     * 宿主自身发起的引擎调用会拿到 `'engine'`（core 层的 origin 缺省值）。
     */
    readonly log?: (text: string, to: string, plugin: string) => void;
    /** Uses the host's real question UI. Cancellation rejects, never implies consent. */
    readonly ask?: (question: string, options: UiAskOptions, signal: AbortSignal) => Promise<string>;
    /** 一次性提示。`$.ui.toast()` */
    readonly toast?: (text: string, timeoutMs?: number) => void;
    /** 状态行。`$.ui.status()` */
    readonly status?: (text: string, plugin: string) => void;
    /** 打开一个面板。`$.ui.open()`；`plugin` 是发起调用的 mod，面板的 `ui.render` 归它画。 */
    readonly openPane?: (pane: Record<string, unknown>, plugin: string) => unknown | Promise<unknown>;
    /** 关闭一个面板。`$.ui.close()` */
    readonly closePane?: (pane: Record<string, unknown>, plugin: string) => unknown | Promise<unknown>;
    /** 当前面板列表。`$.ui.panes()` */
    readonly panes?: () => readonly unknown[] | Promise<readonly unknown[]>;
    /** 作废某个渲染事件的缓存。`$.ui.invalidate()` */
    readonly invalidate?: (event: string) => void;
    /** 给某次工具调用附一条说明。`$.ui.notice()` */
    readonly notice?: (toolUseId: string, text: string) => void;
    /**
     * 把一棵**已序列化**的渲染树送到各个面。
     *
     * 刻意收成「一个面无关的出口」：终端在本进程里画，desktop / web / vscode 在
     * 另一个进程里画（cbc 走 ACP 的 `extNotification`）。宿主自己决定送给哪些面
     * —— `$.session.surfaces()` 本就返回复数，同一棵树可能要同时喂好几个。
     *
     * 树里已经没有函数：交互闭包留在 agent 侧，按元素 key 寻址（见
     * `render-registry.ts`）。因此这个出口的入参一定是可序列化的。
     */
    readonly paint?: (tree: unknown, context: {
        plugin: string;
        surface?: RenderSurface | null;
    }) => void | Promise<void>;
    /**
     * 允许 mod 发起外部网络请求（`$.http.fetch()`）。
     *
     * 默认**不开**：mod 是第三方代码，让它无条件出网是一个需要宿主明确表态的
     * 决定，不该由「忘了配置」来默认开启。不传即明确拒绝。
     */
    readonly allowHttp?: boolean;
    /** Register one authenticated CBC Gateway route owned by the current approved plugin runtime. */
    readonly registerHttpRoute?: (route: Record<string, unknown>, plugin: string) => unknown | Promise<unknown>;
    /**
     * 允许 mod 起子进程（`$.process.run()`）。同上，默认不开。
     */
    readonly allowProcess?: boolean;
    /** 合并后的设置。`$.settings.read()` */
    readonly settings?: (source?: string) => Settings | Promise<Settings>;
    /**
     * 每个 plugin 各自的持久化 KV 的落盘目录。
     *
     * 不传则 `$.store` 退化成**进程内**存储：能用，但重启即失忆。这是刻意的 —— 让
     * 能力可用比让它悄悄失败重要，而「重启丢失」对 mod 来说是可观测的正常状态。
     */
    readonly storeDir?: string;
    /** Persistent store transactions use the host's existing cross-process lock. */
    readonly storeLocks?: PluginStoreLocks;
    /** Validate the complete resulting store under its lock, before committing any mutation. */
    readonly validateStore?: (plugin: string, state: Record<string, unknown>, scope: 'session' | 'global') => void;
    /** `$.model.complete(request)` — the host's model completion call. */
    readonly modelComplete?: (request: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
    /** `$.model.fork(request)` — start a background fork of the current session. */
    readonly modelFork?: (request: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
    /**
     * `$.model.classify(text, labels, options)` — pick the label that best fits.
     *
     * The default implementation (when this binding is missing but
     * `modelComplete` is present) reuses `modelComplete` with a fixed
     * classification prompt template; hosts that have a purpose-built
     * classifier should override.
     */
    readonly modelClassify?: (text: string, labels: readonly string[], options: Record<string, unknown> | undefined, signal: AbortSignal) => Promise<string | undefined>;
    /** `$.mcp.call(server, tool, args)` — dispatch an MCP tool call. */
    readonly mcpCall?: (server: string, tool: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
    /** `$.audio.play(clip, options?)` — play a sound. */
    readonly audioPlay?: (clip: unknown, options: Record<string, unknown> | undefined) => Promise<void>;
    /** `$.audio.speak(text, options?)` — read text aloud (returns TTS receipt). */
    readonly audioSpeak?: (text: string, options: Record<string, unknown> | undefined) => Promise<unknown>;
    /** `$.session.authorize()` — hand back a short-lived credential handle. */
    readonly authorize?: () => Promise<{
        handle: string;
        kind: 'bearer' | 'api-key';
    } | null>;
    /** `$.ui.blit(args)` — repaint a Raster in place without a full re-render. */
    readonly blit?: (args: Record<string, unknown>) => Promise<unknown>;
    /** `$.mcp.connect(server)`: connect one of the plugin's own manifest servers (official `McpConnectResult`). */
    readonly mcpConnect?: (plugin: string, server: string) => Promise<unknown>;
    /** `$.session.version()`: official `SessionVersion`. */
    readonly version?: () => {
        version: string;
        base?: string;
        builtAt?: string;
    };
    /** `$.ui.copy`: write the clipboard of `surface` (official `UiCopyResult`). */
    readonly copy?: (text: string, surface?: RenderSurface) => Promise<{
        isCopied: true;
    } | {
        isCopied: false;
        reason: 'no-surface' | 'no-clipboard' | 'refused';
    }>;
    /** `$.ui.selection()`: what the person last selected; undefined where none is seen. */
    readonly selection?: () => Promise<{
        text: string;
        requestId?: string;
    } | undefined>;
    /** `prompt.compose` core for a plugin's own call: the sections of the last system prompt rendered. */
    readonly composeSections?: () => readonly {
        id: string;
        text: string;
        scope: 'shared' | 'session';
    }[];
    /**
     * `session.append` core: keep `message` in the conversation (`agentId`'s, or main's).
     * Resolves the row as stored, or `{ deny }` for an append the session refuses.
     */
    readonly append?: (input: {
        message: {
            type: string;
            content: unknown[];
        };
        uuid: string;
        agentId?: string;
        plugin?: string;
    }) => Promise<{
        message: unknown;
        uuid: string;
    } | {
        deny: string;
    }>;
    /** `session.send` core: deliver `text` to `to` as the SendMessage tool would. */
    readonly send?: (input: {
        to: string;
        text: string;
        agentId?: string;
        plugin?: string;
    }) => Promise<{
        isDelivered: true;
    } | {
        isDelivered: false;
        reason: string;
    }>;
}
//# sourceMappingURL=host-bindings.d.ts.map