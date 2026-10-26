import { ParsedToolSpec, ParsedToolSpecs } from './tool-spec-protocol';
/**
 * 解析单条 spec 字符串。
 *
 * 接受语法：
 *   - 纯工具名：       Read、mcp__github__create_pr
 *   - 通配模式：       mcp__github__*、mcp__*、*
 *   - Defer 修饰：     Defer(Read)、Defer(mcp__*)、Defer(*)
 *   - NoDefer 修饰：   NoDefer(Bash)
 *
 * 拒绝语法（抛 ToolSpecParseError）：
 *   - 嵌套权限过滤：   Defer(Read(*.md))
 *   - 嵌套修饰：       Defer(NoDefer(X))
 *   - 空内容：         ""、Defer()、"   "
 *   - 误用权限语法：   Read(*.md) 提示去 --allowed-tools
 *   - 含逗号：         "Read,Write" 上层应已 split
 */
export declare function parseSingleToolSpec(raw: string): ParsedToolSpec;
/**
 * 批量解析。
 *
 * 关键约定：
 *   - 去重：同一 pattern 多次出现时，names 只保留首次出现的位置，发出
 *     duplicate-spec warning。
 *   - 冲突仲裁：同一 pattern 出现 Defer(...) 和 NoDefer(...) 时，以最后
 *     一次出现的修饰符胜出（与 --allowedTools 的"后定义覆盖"语义一致），
 *     发出 conflicting-modifier warning。同 pattern 多次重复同一修饰符
 *     不算冲突，仅记 duplicate-spec。
 *   - lenient 模式：{ lenient: true } 时，遇到 ToolSpecParseError 不抛错，
 *     转为 invalid-pattern warning 并丢弃该 spec。供 product agents[].tools
 *     等老配置在新版 CLI 上兼容降级。
 *   - 旧名归一：pattern 抽出后先过 `canonicalizeToolListName`，4.x IDE 名收成
 *     CLI 规范名。必须发生在去重 / overlay 之前，否则 `Defer(read_file)` 的
 *     overlay 会记成 `read_file`，运行时按 `Read` 查 defer 就丢了修饰。
 */
export declare function parseToolSpecs(specs: readonly string[], options?: {
    lenient?: boolean;
}): ParsedToolSpecs;
