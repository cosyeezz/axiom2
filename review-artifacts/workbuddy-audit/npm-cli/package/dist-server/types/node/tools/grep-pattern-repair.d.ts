/**
 * 模型常把字面量括号直接写进正则（如 `spawn(|exec`、`struct Session {`），ripgrep 会以
 * unclosed group 等语法错误拒绝整次搜索。仅在原始正则已被拒绝后调用：把无法配对的 `(` `)`、
 * 紧跟标识符且后接 `|` 或结尾的 `(`（调用形式）、不构成合法量词的 `{` 转义为字面量。
 * 无需修复或无法安全修复（如字符类未闭合）时返回 undefined。
 */
export declare function repairUnbalancedRegexPattern(pattern: string): string | undefined;
