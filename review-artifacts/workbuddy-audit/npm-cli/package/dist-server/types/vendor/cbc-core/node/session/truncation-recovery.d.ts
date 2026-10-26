import type { Session } from './session-protocol';
/**
 * 输出被截断后追加给模型的续写提示（#119765 指定原文，勿改措辞）。
 *
 * 与旧文案的区别是语义：旧提示让模型「重来一遍但做小一点」，这条让它**从断点接着写**。
 * 末句同时覆盖了「把剩下的工作拆小」，因此纯文本与非四工具的工具截断共用它即可。
 */
export declare const TRUNCATION_CONTINUATION_PROMPT: string;
/** 一条连续截断链上允许发起的恢复次数上限：依次允许第 1、2、3 次。 */
export declare const MAX_TRUNCATION_RECOVERIES = 3;
/** 预算计数在 `session.meta` 上的键名。 */
export declare const TRUNCATION_RECOVERY_COUNT_META_KEY = "truncationRecoveryCount";
/**
 * 认领结果。`attempt` 是本次恢复的序号（1-based）；`exhausted` 表示预算已用尽，
 * 调用方必须转为收尾而不是再发起恢复。
 */
export type RecoveryClaim = {
    readonly attempt: number;
} | {
    readonly exhausted: true;
};
export declare function isExhausted(claim: RecoveryClaim): claim is {
    readonly exhausted: true;
};
/** 读取当前连续链已发起的恢复次数；字段缺失一律按 0。 */
export declare function readRecoveryCount(session: Session): number;
/**
 * 「这一轮的回答还没写完，后面还有恢复轮在排」。
 *
 * 供把 run 结束当作「回合结束」的旁路消费方判重用——典型是 prompt suggestion 的
 * Stop hook：一条恢复链上每一层 run 结束都会各打一次 Stop hook，不加区分就会按恢复
 * 次数重复触发，且中间轮次看到的只是半截回答。
 *
 * 之所以用恢复计数而不是另立一个「在途」标记：每个 run 的 Stop hook 都早于它自己的
 * `ModelResponseInterceptor`（interruption-service 处理完 hooks 才发 result 事件，而
 * 拦截器由该事件驱动），因此链上第一次 Stop 发生在额度被认领之前、计数仍为 0，后续
 * 每一层嵌套 run 的 Stop 都在认领之后、计数 ≥ 1。判重因此天然落在第一次。
 *
 * **预算用尽那一轮同样返回 true**：`claimRecoverySlot` 返回 `exhausted` 时不清零，计数
 * 停在上限上，直到链断（`resetRecoveryChain`）或下一个用户请求边界才归零。这是有意的——
 * 那一轮交付给用户的仍是残缺回答，把它当成正常的回合结束去生成建议/标题并不合适。若要
 * 改成「用尽那一轮照常收尾」，改的是这里的语义，不是调用方。
 *
 * **双重语义耦合**：本判据同时被「连续截断链预算」与「本次 run 结束是否算回合结束」
 * 复用（`PromptSuggestionStopHook`、hook 载荷里的 `is_truncation_recovery`）。两者口
 * 径目前一致，但恢复链中途若出现一次非 length 响应，`resetRecoveryChain` 会按预算语义
 * 清零，此后同一链的 Stop hook 也会看到 false。这是设计选择；改 `resetRecoveryChain`
 * 的触发条件时，必须同步复核上述回合结束消费方，避免预算口径变更误伤建议/标题闸门。
 */
export declare function isTruncationRecoveryActive(session: Session): boolean;
/**
 * 同步完成「判定 + 认领」：可恢复则就地把计数写回（+1）并返回序号，否则返回 `exhausted`。
 *
 * 必须同步走完再去做 `addHistory` / `runDefault` 等异步动作——若把「检查额度」和
 * 「消耗额度」分散在 `await` 两侧，两处调用可能都在 `count = MAX - 1` 时通过检查，
 * 上限就形同虚设。
 */
export declare function claimRecoverySlot(session: Session): RecoveryClaim;
/** 认领之后发起失败时回退额度，避免一次没发出去的恢复白占预算。 */
export declare function releaseRecoverySlot(session: Session): void;
/**
 * 链断时清零，返回清掉的旧值供日志使用。
 *
 * 「连续截断链」的口径：中间只要出现一次非 `length` 的模型响应（正常收尾或转去调
 * 工具），就认为模型已经走出截断状态，下次截断重新拥有完整预算。因此单次提问内
 * 截断的**总**次数没有绝对上限，只有**连续**次数有上限。
 *
 * 该状态仅存内存、不持久化（与 `consecutiveMaxTokenCompactCount` 一致）：会话重载
 * 后重新获得完整预算，属可接受行为。
 */
export declare function resetRecoveryChain(session: Session): number;
/**
 * 截断链结束时的归类。
 *
 * 不能一律记 `succeeded`：`error` / `content_filter` 这类同样会让链断开，但它们是失败
 * 终态，标成成功会直接误导排障。`tool_calls` 属于「链断了但这一轮还没完」，单列一档。
 */
export declare function classifyChainOutcome(finishReason: string): 'succeeded' | 'chain_ended' | 'failed';
/**
 * 从「最后一次模型响应」的 usage 里取本次截断的 token 数。
 *
 * 为什么不读 run 级的 `modelResponseMetadata.usage`：那个对象在整个 run 内复用，只有
 * 带 usage 的 chunk 才会覆盖它。于是「先一次带 usage 的 tool_calls、最后一次 length
 * 不带 usage」时，截断日志会记上**前一次**响应的 token，与「按当前响应取值」的要求相反。
 *
 * 缺失判定：SDK 的 `Usage` 在提供方没给 usage 时会构造成全 0，因此这里把
 * `outputTokens === 0` 视为缺失——一次真的撞到输出上限的响应，产出不可能是 0。
 */
export declare function readTruncatedResponseUsage(lastTurnResponse: unknown): {
    promptTokens?: number;
    completionTokens?: number;
    reasoningTokens?: number;
};
/**
 * 选提示：命中四个特殊工具时给该工具的拆分建议，其余一律给续写原文。
 *
 * 选择只依据「本次截断涉及哪些工具」，不依据是哪个执行点在调用——同一个 `Write`
 * 截断不该因为落在不同入口而收到不同指导。
 */
export declare function buildRecoveryPrompt(truncatedToolNames?: readonly string[]): string;
/**
 * 包成 error-recovery system-reminder 后再注入。
 *
 * 裸文本会被 `UserQueryWrapperAgentRunInterceptor` 当成用户输入包进 `<user_query>`，
 * 模型会把内部续写提示读成用户提问；包成带 data-role 的 reminder 后，它与
 * `buildErrorRecoveryReminder` 等其他恢复提示同形，也不会被当成规则型 reminder。
 */
export declare function buildTruncationRecoveryReminder(truncatedToolNames?: readonly string[]): string;
//# sourceMappingURL=truncation-recovery.d.ts.map