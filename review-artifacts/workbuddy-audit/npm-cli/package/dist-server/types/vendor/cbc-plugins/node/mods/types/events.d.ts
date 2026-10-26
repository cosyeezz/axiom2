/**
 * Tier —— 与 Anthropic claude-code `mods/types/claude-code.d.ts` 的
 * `const TIERS: readonly ["prepend", "user", "append", "builtin", "core"]` 完全一致。
 *
 * 外层先执行：`prepend`（企业强制最外）→ `user`（用户装的）→ `append`（企业兜底）
 * → `builtin`（引擎自带 mod）→ `core`（引擎核心行为，也是老 shell hooks 的落点）。
 */
/** Upstream data shapes the kernel uses as they are (Claude Code's own declarations). */
import type { EngineEventOf as UpstreamEngineEventOf, EngineInterface as UpstreamEngineInterface, HookFailure, OpEventOf as UpstreamOpEventOf, TraceOutcome } from './claude-code';
import type { AgentOfferInput, AgentOfferResult, AgentSpawnInput, AgentSpawnResult } from './events/agent';
import type { CommandDescribeInput, CommandDescribeResult, CommandRunInput, CommandRunResult } from './events/command';
import type { PromptAttachmentInput, PromptAttachmentResult, PromptContextInput, PromptContextResult, PromptEditInput, PromptEditResult, PromptFillInput, PromptFillResult, PromptSectionInput, PromptSectionResult, PromptSubmitInput, PromptSubmitResult, PromptSuggestInput, PromptSuggestResult } from './events/prompt';
import type { ToolCallInput, ToolCallResult, ToolCheckInput, ToolCheckResult, ToolDescribeInput, ToolDescribeResult } from './events/tool';
export type { FsAncestorPart, PluginRegisterInput, PluginRegisterUses, SettingsSource, FsAncestor, FsAncestorsRequest, HttpInit, HttpResponse, PaneOpenArgs, ProcessRunInit, ProcessRunResult, SessionAuthorization, SessionCompactInput, Settings, SettingsReadArgs, Timer, HookFailure, TraceOutcome, } from './claude-code';
export declare const TIERS: readonly ['prepend', 'user', 'append', 'builtin', 'core'];
export type Tier = (typeof TIERS)[number];
/**
 * `next.to(e, tier)` 的合法目标：只能往内跳，不能跳回 `prepend` / `user`。
 * 对齐官方 `TargetTier = Exclude<Tier, 'prepend' | 'user'>`。
 */
export type TargetTier = Exclude<Tier, 'prepend' | 'user'>;
/** 一个 mod 的可配置项（来自 plugin.json / settings）。对齐官方 `PluginOptions`。 */
export type PluginOptions = Readonly<Record<string, string | number | boolean | readonly string[]>>;
export interface StoreOptions {
    scope?: 'session' | 'global';
}
/** mod 入口函数签名。对齐官方 `Register = (on: On, options: PluginOptions) => unknown`。 */
export type Register = (on: On, options: PluginOptions) => unknown;
/** 引擎 middleware 事件名：官方 `EngineEventOf` 的键集（来自 vendored 声明）。 */
export type EngineEventName = keyof UpstreamEngineEventOf & string;
/**
 * cbc 自有的 op：官方没有，保留给已有 cbc mod。`ui.ask` 是 cbc 早期的私有 op ——
 * 官方 `$.ui.ask` 走 `tool.call`（AskUserQuestion），这里仅为旧 mod 的 hook 保留名字。
 */
export type CbcOpEventName = 'tool.unregister' | 'command.unregister' | 'http.route.register' | 'ui.ask';
/**
 * Op 事件名 —— `$.<noun>.<op>()` 每次调用同时是一个可拦截的事件。
 * 官方 `OpEventOf` 的键集，加 cbc 自有的几个。
 */
export type OpEventName = (keyof UpstreamOpEventOf & string) | CbcOpEventName;
/** cbc 老 shell hook 事件名（PascalCase，来自 `HookEvent` 枚举值）。 */
export type ClassicHookEvent = 'PreToolUse' | 'PostToolUse' | 'Notification' | 'UserPromptSubmit' | 'Stop' | 'SubagentStop' | 'PreCompact' | 'SessionStart' | 'SessionEnd' | 'WorktreeCreate' | 'WorktreeRemove' | 'PostToolUseFailure' | 'SubagentStart' | 'StopFailure' | 'PostCompact' | 'ConfigChange' | 'InstructionsLoaded' | 'PermissionRequest' | 'PermissionDenied' | 'Elicitation' | 'ElicitationResult' | 'TaskCreated' | 'TaskCompleted' | 'TeammateIdle' | 'Setup' | 'FileChanged' | 'CwdChanged' | 'FinalStop';
/** `classic.<Event>` 事件名族（对齐官方 `ClassicEventName`）。 */
export type ClassicEventName = `classic.${ClassicHookEvent}`;
/** 所有事件名。 */
export type EventName = EngineEventName | OpEventName | ClassicEventName;
/** 事件名的 namespace 部分（`tool.call` → `tool`）。 */
export type Namespace<_E = unknown> = 'tool' | 'ui' | 'agent' | 'prompt' | 'command' | 'config' | 'skill' | 'attribution' | 'session' | 'turn' | 'plugin' | 'engine' | 'model' | 'audio' | 'mcp' | 'fs' | 'store' | 'clock' | 'http' | 'process' | 'settings' | 'env' | 'classic';
/** Glob pattern：`*`（全部）或 `<namespace>.*`。对齐官方 `Glob`。 */
export type Glob = '*' | `${Namespace}.*`;
/** Negation pattern：`!<EventName | Glob>`。对齐官方 `Negation`。 */
export type Negation = `!${Exclude<EventName | Glob, '*'>}`;
/** `on()` 的第一参：具名事件、Glob 或 Negation。对齐官方 `Pattern`。 */
export type Pattern = EventName | Glob | Negation;
/**
 * 事件 input 的通用形状。
 *
 * 官方为每个事件定义了精确类型；cbc 侧用「已知关键字段 + index signature 兜底」
 * 的结构兼容形态：官方 mod 的 `register.ts` 读什么字段都能通过，运行时按 host
 * 实际注入的 payload 为准。
 */
export interface EventInputBase {
    /**
     * 事件主体的提供方（`tool.describe` / `command.describe` / `agent.offer` /
     * `agent.spawn` 上由引擎钉住）。`sec-default` 的 `pastUsers` 读它判断归属。
     */
    provider?: {
        tier?: unknown;
        plugin?: string;
    } | null;
    [key: string]: unknown;
}
/** 事件 input（所有事件统一形状）。 */
export type EventInput = EventInputBase;
/**
 * 事件结果。
 *
 * - **Op 事件**（`<noun>.<op>`）：`{ value }` 承载返回值，`{ deny }` 拒绝。
 * - **Middleware 事件**：各事件自己的字段（`{ result }` / `{ text }` /
 *   `{ description }` / `{ isOffered }` / `{ model }` / `{ value }` …）。
 *
 * 用 index signature 兜底，让官方 mod 的各种返回形态都合法。
 */
/**
 * Type-parameterised for upstream compatibility (`EventResult<N>`, where `N`
 * is the event name whose result this is). cbc uses a structural fallback
 * shape; the type parameter is accepted for compat and not enforced.
 */
export interface EventResult<_N = unknown> {
    /** Op 事件的返回值。 */
    value?: unknown;
    /** 拒绝原因；`tool.call` 场景 = 阻止工具执行。 */
    deny?: string;
    /** `tool.call` 的执行结果。 */
    result?: unknown;
    /** `plugin.register` 拒绝一个 mod 入场。 */
    refuse?: string;
    [key: string]: unknown;
}
/**
 * matcher —— 浅字段 + 深嵌套 + 数组任一 + RegExp + 谓词。
 *
 * 官方用例：
 * - `{ tool: 'Read' }`（值相等）
 * - `{ command: ['clear', 'resume'] }`（数组任一）
 * - `{ component: 'Pane' }`
 * - `{ fork: true }`
 * - `{ instructionFiles: { kind: [...] } }`（深嵌套 + 数组）
 */
export type MatcherValue<_A = unknown> = string | number | boolean | null | RegExp | readonly unknown[] | ((v: unknown) => boolean) | {
    readonly [k: string]: MatcherValue;
};
/**
 * Type-parameterised for upstream compatibility (`Matcher<Args<N>>`); at cbc
 * runtime we discard the parameter and use the structural predicate table,
 * so any generic argument is accepted.
 */
export interface Matcher<_A = unknown> {
    readonly [k: string]: MatcherValue;
}
/**
 * `next` —— 执行下游链。语义对齐官方 `StarNext` / `GlobNext`。
 *
 * - `next(e)`：继续下一层（改写 e 即改写下游看到的入参）
 * - `next.to(e, tier)`：跳到指定 tier 起点继续（只能往内）
 * - `next.origin`：当前 hook 所在的 tier + plugin
 * - `next.event`：本次分发的具名事件（glob hook 靠它分辨）
 * - `next.is(pattern, e)`：事件归属判定（glob hook 内的守卫）
 * - `next.signal`：下游被放弃（超时 / 上层短路）时 abort
 * - `next.budget`：本层的时间预算
 * - `next.trace`：已执行各层的轨迹
 */
/**
 * Type-parameterised for upstream compatibility (`Next<P, N>`), where `P` is
 * the pattern and `N` the event name. cbc's runtime is structural; the type
 * parameters are accepted but not enforced beyond the shape below.
 */
export interface Next<_P = unknown, _N = unknown, _E = unknown, _S = unknown> {
    (e: EventInput): Promise<EventResult>;
    readonly origin: Origin;
    readonly to: (e: EventInput, tier: TargetTier) => Promise<EventResult>;
    readonly event: EventName;
    readonly is: (pattern: Pattern, e: unknown) => boolean;
    readonly signal: AbortSignal;
    readonly budget: NextBudget;
    readonly trace: readonly TraceEntry[];
}
/** hook 所属来源。对齐官方 `Origin`。 */
export interface Origin {
    readonly plugin: string;
    readonly tier: Tier;
    /** Host-resolved package root, never a hook-editable input field. */
    readonly root?: string;
}
/** 本层剩余预算。对齐官方 `NextBudget`。 */
export interface NextBudget {
    readonly ms: number;
    readonly remainingMs: number;
}
/** hook 时间预算常量。对齐官方 `HookBudget`。 */
export declare const HOOK_BUDGET: {
    /** 普通 hook 预算。 */
    readonly ms: 10000;
    /** `catch` handler 预算。 */
    readonly catchMs: 1000;
    /** 返回后下游仍可继续跑的宽限。 */
    readonly lingerMs: 5000;
};
export type HookBudget = typeof HOOK_BUDGET;
/**
 * 单层轨迹。对齐官方 `TraceEntry<E, I, R>` — cbc discards the extra type
 * parameters; the structural fields are the wire shape.
 */
export interface TraceEntry<_E = unknown, _I = unknown, _R = unknown> {
    readonly index: number;
    readonly plugin: string;
    readonly tier: Tier;
    readonly event: EventName;
    readonly outcome: TraceOutcome;
    readonly reason?: string;
    readonly ms: number;
    readonly received: EventInput;
    readonly returned: EventResult | undefined;
}
/**
 * 一个 hook。`$` 是 `engine.create` fold 后的 capability surface。
 *
 * 返回 `undefined` 等价于「不干预」（下游/核心结果直接冒泡）。
 */
export type Hook = ($: EngineInterface, e: EventInput, next: Next) => EventResult | undefined | Promise<EventResult | undefined>;
/** `on()` 的返回值：可挂 `catch` 处理器。对齐官方 `Registration`。 */
export interface Registration {
    readonly catch: (handler: CatchHandler) => void;
}
/** catch handler 拿到的 next：额外带 `error` 与 `called`。对齐官方 `Caught`。 */
export type CaughtNext = Next & {
    readonly error: HookFailure;
    readonly called: boolean;
};
/** Alias of `CaughtNext` matching upstream's exported name. */
export type Caught = CaughtNext;
/** hook 抛错/超时时的兜底处理器；返回 undefined 表示「按未干预处理」。 */
export type CatchHandler = ($: EngineInterface, e: EventInput, next: CaughtNext) => EventResult | undefined | Promise<EventResult | undefined>;
/** 注册器。对齐官方 `On` 的两种重载。 */
export interface On {
    (pattern: Pattern, hook: Hook): Registration;
    (pattern: Pattern, matcher: Matcher, hook: Hook): Registration;
}
/** A plugin-owned Gateway route. The handler is an existing custom noun method, never arbitrary host code. */
export interface HttpRouteRegistration {
    routeId: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    noun: string;
    capability: string;
    requestSchema?: Record<string, unknown>;
    corsOrigins?: readonly string[];
}
export interface HttpRouteRegistrationResult {
    routeId: string;
    url: string;
    generation: number;
}
/** `engine.create` 事件入参。对齐官方 `EngineCreateInput`。 */
export interface EngineCreateInput {
    plugins: readonly string[];
}
export type * from './events/tool';
export type * from './events/agent';
export type * from './events/command';
export type * from './events/prompt';
export type * from './events/upstream';
/**
 * 一个会话消息（`$.session.messages()` 返回数组的元素类型）。
 *
 * 用 `type` 判别；`diff` mod 只关心 `tool.call` 消息（`toolName` / `input`），
 * 官方类型更细，这里给一个通用 discriminated union + index signature 兜底。
 */
export type SessionMessage = {
    readonly type: 'user' | 'assistant' | 'system';
    readonly text?: string;
    readonly [k: string]: unknown;
} | {
    readonly type: 'tool.call';
    readonly toolName?: string;
    readonly input?: Record<string, unknown>;
    readonly output?: unknown;
    readonly [k: string]: unknown;
} | {
    readonly type: string;
    readonly [k: string]: unknown;
};
/**
 * 每个 EventName 对应的入参形状 —— `Args<E>` 是给 mod 作者写
 * `hook($, e: Args<'tool.call'>, next)` 用的。
 *
 * 精确入参存在 `EventInputMap` 里：一次迁一个 namespace，把 upstream 的
 * `EventOf` 键补进来。**未迁**的事件回落到宽松的 `EventInputBase`，保证
 * 老 hook 仍然可写。
 *
 * 迁移次序见 plan 文件 §R1.1；`tool.*` 已迁。
 */
export interface EventInputMap {
    'tool.call': ToolCallInput;
    'tool.check': ToolCheckInput;
    'tool.describe': ToolDescribeInput;
    'agent.offer': AgentOfferInput;
    'agent.spawn': AgentSpawnInput;
    'command.run': CommandRunInput;
    'command.describe': CommandDescribeInput;
    'prompt.submit': PromptSubmitInput;
    'prompt.fill': PromptFillInput;
    'prompt.suggest': PromptSuggestInput;
    'prompt.edit': PromptEditInput;
    'prompt.section': PromptSectionInput;
    'prompt.context': PromptContextInput;
    'prompt.attachment': PromptAttachmentInput;
}
export type Args<E extends EventName = EventName> = E extends keyof EventInputMap ? EventInputMap[E] : EventInputBase;
/**
 * 每个 EventName 对应的结果形状 —— `ResultOf['tool.call']` 之类的官方索引访问。
 *
 * 与 `Args<E>` 一样：精确结果在 `EventResultMap` 里；未迁的回落到宽松
 * `EventResult`。
 */
export interface EventResultMap {
    'tool.call': ToolCallResult;
    'tool.check': ToolCheckResult;
    'tool.describe': ToolDescribeResult;
    'agent.offer': AgentOfferResult;
    'agent.spawn': AgentSpawnResult;
    'command.run': CommandRunResult;
    'command.describe': CommandDescribeResult;
    'prompt.submit': PromptSubmitResult;
    'prompt.fill': PromptFillResult;
    'prompt.suggest': PromptSuggestResult;
    'prompt.edit': PromptEditResult;
    'prompt.section': PromptSectionResult;
    'prompt.context': PromptContextResult;
    'prompt.attachment': PromptAttachmentResult;
}
export type ResultOf = {
    readonly [E in EventName]: E extends keyof EventResultMap ? EventResultMap[E] : EventResult;
};
/**
 * 一次 `$.ui.resolve(e)` 的返回：一张元素工厂表。
 *
 * `diff` mod 的 `ui.render` hook 里写 `const { Box, Text, Button, Select, Code }
 * = await $.ui.resolve(e)` 拿到工厂，然后当 JSX 组件用。这些工厂在运行时**返回
 * `SerializedElement`**（与 `<Box>` 全局函数同形），mod 侧当组件调用。
 *
 * 这也是「元素表是闭集」在 mod 视角的落点：不在这张表里的 tag 无法被 resolve。
 */
export interface ResolvedElements {
    Box: (props: Record<string, unknown>) => JsxElement;
    Text: (props: Record<string, unknown>) => JsxElement;
    Button: (props: Record<string, unknown>) => JsxElement;
    Input: (props: Record<string, unknown>) => JsxElement;
    Select: (props: Record<string, unknown>) => JsxElement;
    Link: (props: Record<string, unknown>) => JsxElement;
    Code: (props: Record<string, unknown>) => JsxElement;
    Markdown: (props: Record<string, unknown>) => JsxElement;
    Image: (props: Record<string, unknown>) => JsxElement;
    Svg: (props: Record<string, unknown>) => JsxElement;
    Raster: (props: Record<string, unknown>) => JsxElement;
    Client: (props: Record<string, unknown>) => JsxElement;
    Fragment: (props: Record<string, unknown>) => JsxElement;
}
/** JSX 元素形状（对齐 `SerializedElement`）。 */
export interface JsxElement {
    readonly type: string;
    readonly props: Record<string, unknown>;
    readonly children: readonly JsxElement[];
}
/** 老 shell hook 的结果字段全集。对齐官方 `ClassicResult`。 */
export interface ClassicResult {
    block?: string;
    preventContinuation?: true;
    stopReason?: string;
    additionalContext?: string[];
    sessionTitle?: string;
    suppressOriginalPrompt?: true;
    initialUserMessage?: string;
    watchPaths?: string[];
    reloadSkills?: true;
    permissionDecision?: 'allow' | 'deny' | 'ask';
    permissionDecisionReason?: string;
    decision?: string;
    updatedToolOutput?: unknown;
    updatedMCPToolOutput?: unknown;
    retry?: true;
    displayContent?: string;
    worktreePath?: string;
}
/** hooks 模块的导出形状。对齐官方 `HooksModule`。 */
export interface HooksModule {
    register: Register;
}
/** `$.ui.invalidate()` 可重放的事件。 */
export type InvalidatableEventName = 'ui.render' | 'prompt.section' | 'prompt.context' | 'prompt.attachment' | 'tool.describe' | 'command.describe' | 'config.describe';
/**
 * `$` —— 每个 hook 的第一参。对齐官方 `CoreEngineInterface` 的 19 个 noun。
 *
 * 每个方法调用同时 dispatch 对应的 op 事件（`$.fs.read(p)` → `fs.read`），
 * 所以上层 mod 可以拦截、改写、拒绝另一个 mod 的任意能力调用 —— 这是
 * `sec-default` 式管控与审计型 mod 的基础。
 *
 * 用 `interface` 而非 `type`，让 mod 通过**声明合并**添加自有 noun（官方
 * telemetry mod 的 `declare module 'claude-code' { interface EngineInterface
 * { telemetry: Telemetry } }` 范式）。
 */
export interface UiAskOptions {
    options: readonly string[];
    header?: string;
    multiSelect?: boolean;
    signal?: AbortSignal;
}
export interface SessionCompactResult extends EventResult {
    /** True only after the host has finished compaction successfully. */
    compacted?: true;
}
/**
 * `$`: the official `EngineInterface` (core nouns, open to `engine.create` additions
 * by declaration merging) plus the nouns a plugin adds at run time.
 */
export type EngineInterface = UpstreamEngineInterface & CbcEngineCalls & {
    readonly [noun: string]: unknown;
};
/**
 * cbc's own `$` calls beside the official ones: its `tool.unregister` /
 * `command.unregister` ops, and the `scope` option of `$.store`.
 */
export interface CbcEngineCalls {
    tool: {
        unregister: (name: string) => Promise<void>;
    };
    command: {
        unregister: (name: string) => Promise<void>;
    };
    http: {
        register: (route: HttpRouteRegistration) => Promise<HttpRouteRegistrationResult>;
    };
    store: {
        get: (key: string, options?: StoreOptions) => Promise<unknown>;
        set: (key: string, value: unknown, options?: StoreOptions) => Promise<void>;
        delete: (key: string, options?: StoreOptions) => Promise<void>;
        keys: (options?: StoreOptions) => Promise<string[]>;
    };
}
/** `engine.create` 的 `next(e)` 结果：对齐官方 `EngineInterfaceBuilt`。 */
export type EngineInterfaceBuilt = EngineInterface;
/** 一个待挂载的 mod。 */
export interface RegisteredMod {
    /** plugin.json 的 name。 */
    readonly name: string;
    /** 挂载 tier。 */
    readonly tier: Tier;
    /** 入口。对齐官方 `Register`：第二参是 options。 */
    readonly register: Register;
    /** plugin.json 的 root 目录（可选，`$.plugin.root` 用）。 */
    readonly root?: string;
    /** 该 mod 的配置项。 */
    readonly options?: PluginOptions;
    /** plugin.json 的 version（官方 `plugin.register` 的 `version`）。 */
    readonly version?: string;
    /** 从 hooks 模块源码读出的 hook 事件与 `$` 调用（官方 `PluginRegisterUses`）。 */
    readonly uses?: {
        readonly events: readonly string[];
        readonly calls: readonly string[];
    };
}
//# sourceMappingURL=events.d.ts.map