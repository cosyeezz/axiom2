/**
 * REPL 折叠标题的兜底规则，供 TUI 调用行与工具结果标题共用同一套口径：
 * 优先模型回填的 description，缺失/空白时回退到 code 的第一行非空代码，
 * 仍无内容才回退到调用方给定的 fallback。
 *
 * 放独立无重依赖文件：cbc-tui 的调用行经 @genie/agent-cli/node/... 引入，
 * 不能拖入 REPLTool / worker 等重依赖，因此这里只依赖 display-controls。
 */
/** code 的第一行非空代码（剥离控制字符、去首尾空白）。无有效行时返回空串。 */
export declare function firstNonBlankCodeLine(code: unknown): string;
/**
 * 计算 REPL 折叠标题：description → code 首行 → fallback。
 * description 与 code 都可能带模型产出的控制字符，统一剥离后再判定。
 */
export declare function replHeadline(description: unknown, code: unknown, fallback: string): string;
