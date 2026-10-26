/**
 * 行摘要（对齐 Claude 的 Haiku 摘要行为，G1）。
 *
 * Claude：回合结束用小模型写一句摘要；长回合每几分钟重写一次；两次模型
 * 摘要之间直接复用会话自己的输出（不发请求）。
 *
 * 本仓分层：
 * - 复用层（零成本）：working 行有了本回合的新输出，就用它的首句当
 *   detail，替代 'running a tool' 这类相位短语。
 * - 模型层：回合持续超过 {@link ROW_SUMMARY_MODEL_MS} 时，用
 *   SUMMARY_GENERATOR（runOneTime 轻量通道）重写一句现在进行时摘要，
 *   之后每隔同样的间隔刷新。失败静默保留旧 detail。
 * - 回合结束仍写 `result: <首行>`（真实答案首行比模型转述更可信，
 *   也是既有测试钉死的契约）—— 与 Claude 的 turn-end 摘要为已知偏差。
 *
 * `CODEBUDDY_CODE_DISABLE_ROW_SUMMARY=1` 一键关闭（企业合规可能不想
 * 让后台会话多发请求）。
 *
 * 纯函数层：节流判定 / 文本清洗 / prompt 构造，不碰 DI 与时钟。
 */
/** 长回合触发模型摘要的间隔（回合开始后首次，与后续刷新共用） */
export declare const ROW_SUMMARY_MODEL_MS = 180000;
/** detail 单行长度上限（TUI 列宽有限，超长会被行渲染截断得难看） */
export declare const ROW_SUMMARY_MAX_CHARS = 72;
/** 一键关闭行摘要（复用层 + 模型层一起关） */
export declare const ENV_DISABLE_ROW_SUMMARY = "CODEBUDDY_CODE_DISABLE_ROW_SUMMARY";
export declare function isRowSummaryDisabled(env?: NodeJS.ProcessEnv): boolean;
export interface RowSummaryClock {
    /** 本回合开始时刻 */
    turnStartMs: number;
    /** 上一次模型摘要请求时刻（0 = 本回合还没发过） */
    lastModelAtMs: number;
}
/** 长回合才值得花一次小模型请求；之后按同样间隔刷新 */
export declare function shouldRequestModelSummary(clock: RowSummaryClock, nowMs: number): boolean;
/**
 * 复用层：把会话自己的输出压成一行 detail。
 *
 * 取首个非空行，剥掉 markdown 标记/引号/代码围栏，压平空白，截断。
 * 清洗后为空（比如整段都是代码围栏）返回 undefined —— 调用方保留相位短语。
 */
export declare function sessionTextSummary(text: string | undefined): string | undefined;
/**
 * 模型层输出清洗：模型可能带引号/句号/换行/前缀客套。
 * 只接受一行、非空、清洗后不超长的输出；其余返回 undefined（保留旧 detail）。
 */
export declare function sanitizeModelSummary(raw: string | undefined): string | undefined;
/** 摘要 prompt：数据用 <session> 标签围住（对齐 session-title 的防注入做法） */
export declare function buildRowSummaryPrompt(input: {
    intent: string;
    recentText: string;
}): string;
