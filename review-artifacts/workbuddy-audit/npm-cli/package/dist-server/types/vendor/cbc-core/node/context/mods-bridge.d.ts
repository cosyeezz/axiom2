import { type AgentInputItem } from '../../../cbc-shared/node/index.js';
import type { PromptContext } from './context-protocol';
export interface ModsPromptSubmitResult {
    text?: string;
    drop?: string;
    context?: readonly string[];
}
export interface ModsPromptAttachment {
    readonly type: 'image' | 'audio' | 'document';
    readonly mediaType?: string;
    readonly filename?: string;
}
export interface ModsExecutionContext {
    readonly sessionId: string;
    readonly cwd: string;
    readonly signal?: AbortSignal;
}
export interface ModsToolCall {
    readonly name: string;
    readonly input: unknown;
    readonly callId?: string;
    readonly agentId?: string;
    readonly signal?: AbortSignal;
    readonly onResult?: (result: {
        context?: readonly string[];
        isError?: boolean;
    }) => void;
}
export interface ModsToolDescription {
    readonly description: string;
    /** Omission keeps the Agent's existing placement policy. */
    readonly isDeferred?: boolean;
}
/** Host-only provenance: a mod initiated submission has already traversed the fold. */
export declare const MODS_PROMPT_SUBMITTED_KEY = "modsPromptSubmitted";
/**
 * Function hooks（Claude mods）在 core 侧的**窄接口**。
 *
 * ## 为什么 core 不直接调 mods
 *
 * `cbc-core` 只允许依赖 `@genie/cbc-shared`（见仓库 CODEBUDDY.md 的单向依赖卡点，
 * `package-boundaries.spec.ts` 会扫源码 import、动态 import 与依赖声明）。而 mods
 * 引擎住在 `cbc-plugins`。所以 core 这一侧只声明「我会在这几个时刻问一句」，具体
 * 分发由宿主实现后注入。
 *
 * ## 为什么形状映射也不在 core
 *
 * cbc 的 `PromptContext` 是一个松散字典，官方 `prompt.context` 事件是
 * `{ blocks, instructionFiles }`。两者的对应关系属于**适配**，而适配是宿主的事 ——
 * 让 core 认识官方 payload 等于把上游协议渗进核心包，将来上游改一次形状，core 就
 * 得跟着改。因此接口按 core 自己的类型说话，桥的实现负责翻译。
 *
 * ## 未注入时必须是零开销
 *
 * function hooks 默认关闭。没有桥时每个调用点只多一次 `=== undefined` 判断，
 * 不构造对象、不进 async、不改变任何既有行为。
 */
export interface ModsBridge {
    /** Host middleware; the execution callback retains validation and permission checks. */
    toolCall?<T>(input: ModsToolCall, execute: (input: unknown) => Promise<T>): Promise<T>;
    toolDescription?(name: string, description: string, isDeferred?: boolean): Promise<ModsToolDescription>;
    /** First-message context, cached by the owning Session until its history resets. */
    initialContext?(context: PromptContext, render: (context: PromptContext) => Promise<string | undefined>): Promise<readonly string[]>;
    /**
     * 上下文装配完成、尚未拼成最终 prompt 时问一句。
     *
     * @param context 当前这一版上下文
     * @returns 可能被 mod 改写过的上下文；桥自身出问题时应原样返回入参
     */
    promptContext(context: PromptContext): Promise<PromptContext>;
    /**
     * 会话建立时通知一次。
     *
     * @param input 会话 cwd 与是否交互式 —— 官方 `session.start` 的入参
     */
    sessionStart(input: {
        cwd: string;
        isInteractive: boolean;
    }): Promise<void>;
    /**
     * 用户提交输入时问一句。对齐官方 `prompt.submit`。
     *
     * @param input 即将送达模型的文本
     * @returns `{ drop }` 阻断输入，`{ text }` 改写可见文本；附件与隐藏上下文由 core 保留。
     */
    promptSubmit(input: {
        text: string;
        attachments?: readonly ModsPromptAttachment[];
        sessionId?: string;
        signal?: AbortSignal;
    }): Promise<ModsPromptSubmitResult | undefined>;
    /**
     * 把一条 mod 打出来的 `$.ui.log` 行落到用户可见的会话里。
     *
     * ## 为什么走桥而不是让 core 直接推消息
     *
     * `$.ui.log` 是 mod 侧发起的用户可见事件（官方语义：进 transcript），但 core
     * 不知道"当前会话"是哪一个（AsyncLocalStorage 上下文由宿主入口决定），也不认
     * `plugin` 这个身份维度（那是 mods 引擎的概念）。宿主拿到这一对
     * `(text, plugin)` 之后，负责取当前 session 并 push 进 `inputSubject` /
     * `combineSubject` / `sessionStore.appendHistory`，就跟宿主自己的系统消息
     * 是同一条路径。
     *
     * ## 未装桥时的兜底在哪
     *
     * 宿主没实现这一项时，`bindings.log` 侧应当把行文继续写到 stderr（headless /
     * bootstrap 早期 / 无当前 session 时用得到）—— 那种场景下用户看不到"消息历史"，
     * 但仍能通过日志追溯这一行，与既有行为保持一致。
     *
     * @param text 已由宿主前缀好 `<plugin>: ` 的完整行文（core 不重复加前缀）
     * @param meta 至少携带 `plugin`；用于前端识别 / 分组
     */
    pushModLog?(text: string, meta: {
        plugin: string;
    }): void;
    /**
     * 一条记录即将进入会话历史时问一句。对齐官方 `session.append`：hook 可改写
     * 文本块与 tool_result 内容，桥就地写回 `item`；其余部分保持原样。
     *
     * @param item 即将入历史的记录（就地改写）
     * @param session 所属会话：子 agent 会话带 `parentSessionId`
     */
    /**
     * 引擎压缩前问一句。对齐官方 `session.compact`（trigger `manual` / `auto`）：
     * hook 可改写 `instructions`，或回 `{ skip }` 否决这次压缩。
     */
    sessionCompact?(input: {
        trigger: 'manual' | 'auto';
        instructions?: string;
        agentId?: string;
        history: readonly AgentInputItem[];
    }): Promise<{
        instructions?: string;
        skip?: string;
    } | undefined>;
    /** 会话结束时通知一次。对齐官方 `session.end`（`/clear`、退出、恢复他会话）。 */
    sessionEnd?(input: {
        reason: string;
        sessionId: string;
        resume: {
            id: string;
        };
    }): Promise<void>;
    sessionAppend?(item: AgentInputItem, session: {
        readonly id: string;
        readonly parentSessionId?: string;
        readonly model?: string;
    }): Promise<void>;
}
/** A Server query owns its bridge; child work inherits the originating execution. */
export declare function withModsBridge<T>(bridge: ModsBridge | undefined, context: ModsExecutionContext, run: () => T): T;
export declare function currentModsExecutionContext(): ModsExecutionContext | undefined;
/**
 * 注入桥。宿主在 mods 运行时起来之后调用一次。
 *
 * @param next 桥实现；传 `undefined` 卸载（测试用）
 */
export declare function setModsBridge(next: ModsBridge | undefined): void;
/** 当前桥；未注入时 undefined。 */
export declare function currentModsBridge(): ModsBridge | undefined;
/**
 * 经桥过一遍上下文。
 *
 * **桥出问题不能影响主流程**：mod 是第三方代码，它抛错、超时、返回垃圾，都只该
 * 让 function hooks 这一层失效，而不是让会话起不来。因此这里兜住一切异常并回退到
 * 原上下文 —— 与「加载失败不阻塞宿主」同一条原则。
 *
 * @param context 当前上下文
 * @returns 改写后的上下文；无桥或出错时是原对象
 */
export declare function throughModsPromptContext(context: PromptContext): Promise<PromptContext>;
/** A failed third-party fold must not corrupt or lose the original input. */
export declare function throughModsPromptSubmit(text: string, sessionId?: string, signal?: AbortSignal, attachments?: readonly ModsPromptAttachment[]): Promise<ModsPromptSubmitResult | undefined>;
/** Mutates only user text, before the shared history/model consumers see these items. */
export declare function applyModsPromptSubmit(items: AgentInputItem[], sessionId: string, signal?: AbortSignal): Promise<string | undefined>;
/**
 * 通知会话开始。同样绝不向外抛。
 *
 * @param input 会话 cwd 与是否交互式
 */
export declare function notifyModsSessionStart(input: {
    cwd: string;
    isInteractive: boolean;
}): Promise<void>;
/** 经桥过一遍即将入历史的记录；无桥或桥出错时原样保留。 */
export declare function throughModsSessionAppend(item: AgentInputItem, session: {
    readonly id: string;
    readonly parentSessionId?: string;
    readonly model?: string;
}): Promise<void>;
/** 经桥通知会话结束；无桥或桥出错时什么也不做。 */
export declare function notifyModsSessionEnd(input: {
    reason: string;
    sessionId: string;
    resume: {
        id: string;
    };
}): Promise<void>;
/** 经桥问一次引擎压缩；无桥或桥出错时不干预。 */
export declare function throughModsSessionCompact(input: {
    trigger: 'manual' | 'auto';
    instructions?: string;
    agentId?: string;
    history: readonly AgentInputItem[];
}): Promise<{
    instructions?: string;
    skip?: string;
} | undefined>;
//# sourceMappingURL=mods-bridge.d.ts.map