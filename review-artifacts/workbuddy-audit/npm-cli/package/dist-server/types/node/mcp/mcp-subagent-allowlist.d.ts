/**
 * 子代理 MCP 白名单判定（McpSubagentToolManager 的调用面）—— ToolSearch、REPL 骨架目录与
 * REPL 发现 / 执行 API 共用一份实现。
 *
 * 子代理 MCP 白名单原先只在 REPL broker 的发现 / 执行路径上判，骨架目录豁免 —— 模式开 MCP
 * （站立 PTC）时，只读子代理的骨架目录会列出它自己白名单外的 MCP 工具，与「目录里看得到 ==
 * 调得动」的契约矛盾。所以几处共用本函数。
 *
 * 归属 mcp 域而不是 tools/repl：server 产物（workbuddy 工具预设不含 REPL）把 `tools/repl/`
 * 整个目录置空。本函数曾放在 `tools/repl/repl-sandbox-allowlist.ts`，ToolSearch 从那里导入后，
 * served 会话里每次有命中的 ToolSearch 都报 `isMcpToolAllowedForAgent is not a function`。
 */
/**
 * 子代理 MCP 白名单：只约束 `mcp__` 前缀工具；裸名 MCP 是透明代理的全局能力，
 * 走白名单会误杀。agent 未注册白名单时全部放行。
 *
 * **拿不到判定结果时，两个面必须相反**（安全走查 #128343 / authnz.authz.missing_check）：
 * - 发现面（骨架目录 / searchTools / describeTool / ToolSearch）：fail-open。一次 DI 抖动不该把
 *   整个 MCP 面静默关掉，代价只是模型「多看见」几个候选。
 * - 执行面（`repl-bridge-broker.callTool`）：fail-closed（传 `{ failClosed: true }`）。本函数
 *   返回 true 等于**放行执行**，所以「判定不出来」绝不能当成允许 —— 否则受限子代理（如
 *   Explore）的 MCP 收窄会在一次容器/查询异常后整体失效，且调用方与日志都拿不到拒绝信号
 *   （静默旁路授权）。历史教训：本函数被复用前，执行路径用的是私有实现（无 try/catch，
 *   抛错即失败）；复用成同一份 fail-open 实现时语义被悄悄放宽。
 */
export interface McpAllowlistCheckOptions {
    /**
     * 判定不出来（容器未装配 / 白名单查询抛错）时怎么办：`true` 拒绝、`false` 放行。
     *
     * **刻意设成必填**（评审 #128343）：本函数把 fail-open 与 fail-closed 压进同一个布尔返回值
     * —— 返回 `true` 同时代表「查过了，确实允许」和「查不了，放行了」。设成可选的话，新增调用点
     * 的人只要漏传就**静默获得 fail-open 的执行面**，而这正是本 PR 修的那个历史教训
     * （「复用成同一份 fail-open 实现时语义被悄悄放宽」）。必填 = 让 TypeScript 在每个调用点
     * 强制显式表态，零运行时成本，比注释可靠。
     *
     * 口径：**执行面一律 true**（放行 = 真的执行），**发现面一律 false**（一次 DI 抖动不该把整个
     * MCP 面静默关掉，代价只是模型多看见几个候选）。
     */
    readonly failClosed: boolean;
    /**
     * 该工具是不是**裸名 MCP**（`isBare`，形如 `list_issues`，没有 `mcp__` 前缀）。
     *
     * 不能只按前缀判「是不是 MCP 工具」：`defer-execute-tool` 的口径是
     * `startsWith('mcp__') || toolInfo?.isBare === true`，broker 自己也有同款判定。
     * 漏掉裸名会让 fail-closed 在这类工具上失效 —— 注释大于实现（评审 #128343）。
     * 调用方拿不到 isBare 时不要瞎猜：裸名工具在执行面另有 `sandboxBuiltinAllowlist`
     * 那道门（裸名不带前缀，会走内置白名单路径）。
     */
    readonly isBare?: boolean;
}
export declare function isMcpToolAllowedForAgent(agentName: string | undefined, toolName: string, options: McpAllowlistCheckOptions): boolean;
