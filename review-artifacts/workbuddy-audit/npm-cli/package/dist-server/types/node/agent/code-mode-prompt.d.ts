/** 契约已在 overlay 里时不要再拼一份。`--system-prompt` 没有 Tool usage 段时仍靠 APPEND。 */
export declare function appendInstructionsIfMissing(base: string, append?: string): string;
/**
 * REPL 在 Code Mode 下的模型面描述。覆盖 product `tool-repl-description`：
 * 那份模板按「REPL 是可选编排层」写的，会教模型一次性 Bash/Read 走直连。
 */
export declare function codeModeReplToolDescription(mode: 'ptc' | 'minimal', options?: {
    overlay?: boolean;
}): string;
/**
 * 收窄 Code Mode（Minimal）注入的项目规则 / memory 正文：把「去调 Read/Write」改成
 * Bash/Edit，并补一句总闸。PTC / 原生原文不动。
 *
 * `options.delegate`：委托模式提醒叠在 Code Mode（PTC / Minimal）上时补一句「协调工具在 REPL 内」，
 * 避免与「REPL 是唯一直连工具」的契约互相矛盾；委托下不做极简的 Bash/Edit 改写（协调者没有它们）。
 */
export declare function adaptInjectedTextForCodeMode(text: string | undefined, mode: 'ptc' | 'minimal' | undefined, options?: {
    delegate?: boolean;
}): string | undefined;
/**
 * Overlay stock cli-agent-prompt (or host `--system-prompt`) so Code Mode
 * does not keep teaching native Bash/Read/Glob. WorkBuddy `cli` never hits this.
 *
 * `# Tool usage policy` is replaced with the mode contract (one copy), not a
 * shorter paraphrase. If that heading is missing (`--system-prompt`), the
 * contract is inserted once after `</content_policy>` or prepended.
 *
 * Stock 里点名 Glob/Read/WebFetch 的句子必须按模式改写：极简没有这些沙箱工具，
 * 不能改成 `await Read` / `await Glob`（那是 PTC 的写法）。
 */
export declare function rewriteCliPromptForCodeMode(prompt: string, mode: 'ptc' | 'minimal', options?: {
    overlay?: boolean;
    delegate?: boolean;
}): string;
