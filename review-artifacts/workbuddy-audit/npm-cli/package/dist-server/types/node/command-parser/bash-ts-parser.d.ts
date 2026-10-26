/**
 * Pure-TypeScript bash command parser producing tree-sitter-bash-compatible ASTs.
 *
 * 目的：替代 `web-tree-sitter` + `tree-sitter-bash.wasm`，消除 Emscripten WASM runtime
 * 的 ~32MB 线性内存与 wasm 文件分发，同时保持 tree-sitter级的**子命令拆分精度**
 * （用于 Bash 工具的权限匹配，见 `permission-utils.ts` → `CommandParserService`）。
 *
 * 对标Claude Code：其 `src/utils/bash/bashParser.ts` 亦是纯 TS parser 产出
 * tree-sitter-bash 兼容 AST、`ensureParserInitialized` 为 no-op、零WASM。实测纯 TS 解析
 * 比 WASM 快 ~40%（bash 命令短，省去 JS↔WASM 跨边界marshalling 与建完整 AST 的固定开销）。
 *
 * 产出的 AST 只覆盖 `TreeSitterParserStrategy.traverseAndExtract` 消费的节点类型子集：
 *   容器：program / list / pipeline / redirected_statement / subshell /
 *         command_substitution / process_substitution
 *   命令：command / command_name
 *   参数：word / string / raw_string / ansi_c_string / number / concatenation
 *   重定向：file_redirect / heredoc_redirect / herestring_redirect
 *   操作符字面量：`&&` / `||` / `;` / `|` / `|&`（作为 .type 与 .text 均为该符号的子节点）
 *   错误：ERROR（并置 rootNode.hasError=true），触发上层回退到 shell-quote/regex。
 *
 * 节点接口与 web-tree-sitter 的 `SyntaxNode` 对齐（本 strategy 用到的部分）：
 *   type / text / childCount / child(i) / namedChildCount / namedChild(i) / hasError
 *   Tree: rootNode。
 *
 * 不追求完整 bash 语法树——只保证"命令边界 + 命令名 + 参数 + 复合/管道/重定向/替换的拆分"
 * 与 tree-sitter-bash 在权限判定语义上等价。无法可靠解析时置ERROR，让上层安全回退。
 */
export type BashNodeType = 'program' | 'list' | 'pipeline' | 'redirected_statement' | 'subshell' | 'command_substitution' | 'process_substitution' | 'command' | 'command_name' | 'declaration_command' | 'variable_assignment' | 'word' | 'string' | 'raw_string' | 'ansi_c_string' | 'number' | 'concatenation' | 'file_redirect' | 'heredoc_redirect' | 'herestring_redirect' | '&&' | '||' | ';' | '|' | '|&' | 'ERROR';
/**
 * 兼容 web-tree-sitter `SyntaxNode` 的最小节点实现（仅本 strategy 用到的成员）。
 */
export declare class BashNode {
    readonly type: BashNodeType;
    readonly text: string;
    readonly children: BashNode[];
    constructor(type: BashNodeType, text: string, children?: BashNode[]);
    get childCount(): number;
    child(index: number): BashNode | null;
    /** named child = 非纯标点/操作符字面量节点（对齐 tree-sitter 的 named/anonymous 区分）。 */
    private get namedChildren();
    get namedChildCount(): number;
    namedChild(index: number): BashNode | null;
    /** 方法形式（对齐 newer web-tree-sitter；strategy 里对方法/属性两种形态都做了兼容）。 */
    hasError(): boolean;
}
export declare class BashTree {
    readonly rootNode: BashNode;
    constructor(rootNode: BashNode);
}
/**
 * 解析入口：返回兼容 tree-sitter 的 BashTree。
 * 无法可靠解析（未闭合引号/括号、结构异常、超长输入）→ 返回 rootNode.type='ERROR' 的树，
 * 让 `CommandParserService` 安全回退到 shell-quote/regex。
 */
export declare function parseBashCommand(source: string): BashTree;
