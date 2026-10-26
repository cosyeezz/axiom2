/**
 * REPLBridgeBroker —— worker 的 toolCall / replApi / resolve / bridgeOp 落点(主线程)。
 *
 * 三条分流(见 docs/repl-code-mode/mcp-code-mode-design.md §4.1):
 *  - 工具调用 callTool → 主动 checkPermission → 产品交互工具走 nested interruption，
 *    其余 DeferExecuteTool.routeToolCall
 *  - 工具发现 searchTools / describeTool(s) → ToolSearchService(只读,不过权限判定)
 *  - 外部桥   resolve / invoke → BridgeHost
 *
 * agent-cli 对外部桥零业务:只认 BridgeHost SPI,不知道 browser/computer 具体是什么。
 */
import { InterruptionService, Session } from '../../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { REPLCatalog, ReplCatalogSource } from '../../agent/code-mode-protocol';
import { AgentScopedMcpManager, McpManager } from '../../mcp/mcp-protocol';
import { ToolManager } from '../tool-protocol';
import { ToolSearchService } from '../tool-search-protocol';
import { AgentToolDeferOverlayCache } from '../tool-spec';
import { BridgeEntry, SearchToolsOptions, ToolDescriptor, ToolSearchHit } from './repl-catalog-protocol';
import { BridgeApiDescriptor, BridgeCallOpts, BridgeHost, BridgeInvokeOp, BridgeResult, REPLBridgeBroker, type ReplToolCallReply } from './repl-protocol';
export declare class REPLBridgeBrokerImpl implements REPLBridgeBroker {
    protected readonly logger: Logger;
    protected readonly host?: BridgeHost;
    protected readonly toolSearchService: ToolSearchService;
    protected readonly replCatalogSource?: ReplCatalogSource;
    protected readonly toolManager: ToolManager;
    protected readonly overlayCache: AgentToolDeferOverlayCache;
    protected readonly mcpManager?: McpManager;
    protected readonly agentScopedMcpManager?: AgentScopedMcpManager;
    protected readonly interruptionService?: InterruptionService;
    resolve(_session: Session, specifier: string): Promise<BridgeApiDescriptor | null>;
    invoke(session: Session, op: BridgeInvokeOp, opts?: BridgeCallOpts): Promise<BridgeResult>;
    listBridges(_session: Session): Promise<BridgeEntry[]>;
    callTool(context: RunContext<Session>, toolName: string, params: Record<string, unknown>, opts?: BridgeCallOpts & {
        expectedMcpOwner?: string;
    }): Promise<ReplToolCallReply>;
    private callProductInteractionTool;
    /**
     * 主动跑权限判定。**必须主动调**:REPL 的 toolCall 不经 AgentService,不调则
     * deny rules 与命令安全检查全被绕过(模型可在 code 里写 Bash({command:"rm -rf /"}))。
     *
     * 拦截口径分两类:
     *  - **deny**:恒拦(deny 规则 / --disallowed-tools / dontAsk 转 deny / auto 分类器 deny)。
     *  - **危险操作的 ask**:命令安全检查(CRITICAL/HIGH/unsafe 命令,`type:'toolValidation'`)
     *    与敏感文件访问(`type:'sensitiveFile'`)产出的是 `ask` 而非 `deny`。直连 Bash 会对
     *    这类 ask 弹窗让用户批准/拦下;REPL 内层同样不能静默——由 requestSecurityApproval
     *    弹嵌套审批(可交互形态),批准即放行;静默形态/UI 缺失才回错误拦下(不 abort 父
     *    REPL,模型可 r.error 改路)。若同普通 ask 一样放行,模型把 `rm -rf` / 读 SSH key
     *    包进 code 就能绕过这道安全确认(比直连更弱)。
     *
     * Auto 模式残留的 ask 必须逐动作确认，包括分类器回退与显式 ask 规则；
     * 非 Auto 的普通 ask 沿用整段 code 的授权，不对每个普通工具重复打扰。见 §4.8。
     *
     * @returns 被拒时返回错误文案；通过返回 undefined。
     */
    private checkPermission;
    /**
     * 安全类 ask（命令安全检查 / 敏感文件）在 REPL 内层的处置 —— 对齐直连的"可批准"。
     *
     * 背景：直连下这类 ask 会弹审批窗（HIGH/CRITICAL 每次确认、bypass 也不例外），
     * 用户批准后才执行；REPL 内层此前没有弹窗通道，只能直接拦——`git stash drop` /
     * `git reset --hard` / 敏感文件读写等在 PTC 下完全不可执行。这里复用嵌套审批机制
     * （requestReplSecurityApproval → enqueueSandboxApproval）补上弹窗：
     *
     * - 用户批准 → 放行（返回 undefined，调用方继续执行）；
     * - 用户拒绝 / cell 取消 / 会话中止 → 拦下（不 abort 父 REPL，模型可改路）；
     * - 静默形态（print / SDK，shouldAvoidNestedUi）→ 无法弹窗，按既有安全口径拦，
     *   文案补"出路"指引（permissions.allow / 交互式会话）；
     * - UI 服务缺失或弹窗链路异常 → fail-closed 拦（与 sandbox guard 的
     *   "approval UI unavailable; denying" 同口径）。
     */
    private requestSecurityApproval;
    /**
     * 对齐直连：在核心权限判定为 ask 时触发 command PermissionRequest hook（与
     * tool-permission-service.ts:631 同一入口 SessionHookManager.executePermissionRequestHooks）。
     * broker 只调核心解析器 checkPermission(:107)，不经外层 needsApproval 包装，故这里补发。
     * hook 可通过 hookSpecificOutput.decision 覆盖为 allow/deny；无表态时返回 undefined，
     * 交回调用方处理：安全类与 Auto 残留 ask 走嵌套审批，非 Auto 普通 ask 沿用外层授权。
     * suggestions 首版传 undefined。
     */
    private dispatchReplPermissionRequest;
    /**
     * checkPermission 自身异常时的 fail 方向。返回 true = 拒绝（fail-closed）。
     *
     * 只有同时满足以下三条才允许放行（fail-open）——即正常路径上 deny 无从产生：
     *  1. 无任何 deny 规则（settings `permissions.deny` 各 scope + `--disallowed-tools`）；
     *  2. 非 print 模式（`shouldAvoidPermissionPrompts` 会把未 allow 的工具默认 deny）；
     *  3. 权限模式在白名单内：Default / AcceptEdits（ask 在 broker 本就不拦）、
     *     BypassPermissions / FullAccess（用户显式全放行）。DontAsk（ask→deny）、
     *     Auto（分类器可 deny）、Plan / Delegate / 未知模式一律 fail-closed。
     */
    private mustFailClosedOnPermissionError;
    /**
     * 本会话是否配置了任何 deny 规则（settings `permissions.deny` 各 scope +
     * `--disallowedTools`）。口径与 ToolPermissionService Phase 1 的
     * `allDenyRules = [...denyRules, ...disallowedTools]` 同源。
     */
    private hasAnyDenyRule;
    searchTools(context: RunContext<Session>, query: string | string[], opts?: SearchToolsOptions, snapshot?: REPLCatalog): Promise<ToolSearchHit[]>;
    describeTool(context: RunContext<Session>, name: string, snapshot?: REPLCatalog): Promise<ToolDescriptor | null>;
    describeTools(context: RunContext<Session>, names: string[], snapshot?: REPLCatalog): Promise<Record<string, ToolDescriptor | null>>;
    private overlayOf;
    /**
     * `Defer(X)` overlay 命中的内置工具可能尚未索引（索引按 product 静态配置建）。
     * 点名查只索引问到的那个；关键词搜索引全部精确条目。
     * 通配条目（`Defer(mcp__*)`）不处理——模式反向枚举不出工具名，且 MCP 索引由
     * mcp-manager 异步驱动。见 §4.3.3 易漏点 ③。
     */
    private ensureForceDeferIndexed;
    private isCurrentMcpOwner;
    /** 精确取会话目录里的 canonical，歧义时 fail-closed，不再按名字猜 owner。 */
    private catalogToolByCanonical;
    /** 模型面 server 参数接受逻辑原名与 mcp 的安全访问路径。 */
    private matchesSearchServer;
    private serverNameOf;
    /**
     * 沙箱内置工具的**有效白名单**：模式级列表（极简 Bash/Edit/Skill、PTC+overlay 协调器
     * 白名单）与 agent / session `--tools` 白名单取交集；模式列表缺省（站立 PTC）= 上游
     * 原样。与骨架目录（repl-catalog-source）共用 `intersectModeSandboxTools`，只收窄、
     * 不放宽 —— 子代理继承模式后不能被模式列表放出自己定义里没有的工具。
     *
     * `undefined` = 上游「不过滤」（主会话 Code Mode 的常态）且无模式列表。
     */
    private sandboxBuiltinAllowlist;
    /**
     * 内置工具是否真的会出现在沙箱里：与骨架目录（repl-catalog-source）和 searchTools 同源，
     * 都取 `getAllowedToolsForAgent`（它会 await 每个工具的 isEnabled），Code Mode 收窄时与
     * `sandboxTools` **取交集**（模式列表只做收窄 —— 子代理继承模式后不能被它放出白名单外的工具）。
     *
     * MCP 工具不走这里（不在 agent.tools 里），由 isMcpToolAllowedForAgent / isMcpToolReplExposed 判。
     * 白名单读取失败时放行，避免发现能力因一次 IO 抖动整体失效（执行层仍有自己的门）。
     *
     * `precomputedAllowedTools` 只给循环内的调用方（searchTools）复用一次性取到的白名单，
     * 语义与缺省完全一致（undefined = 拿不到 → 放行）；单次调用方（describeTool）不传。
     */
    private isBuiltinAllowedForSandbox;
    /** 注册表里该工具的别名（deny 规则按 [name, ...aliases] 匹配，与 AgentManager 同口径）。 */
    private aliasesOf;
    /** 每工具 isEnabled：拿不到工具或不支持该钩子按放行处理（与骨架 isSandboxToolEnabled 同口径）。 */
    private isToolEnabledInSandbox;
    /**
     * repl_expose 白名单（执行层，与 repl-catalog-source.ts 同口径）：只约束 `mcp__`
     * 前缀工具与会话 MCP 的 server 级 opt-in。内置工具不走此路径；宿主透明代理
     * 工具使用目录中记录的所属 server，不能因裸名而跳过会话暴露配置。
     *
     * **fail-closed**：查不到 server config / McpManager 缺失 / list() 抛错时一律拒绝
     * （返回 false）。理由与发现层一致——白名单默认 false，"拿不到配置"必须等价于"未
     * 暴露"，否则查询失败会变成绕过白名单的旁路。
     */
    private isMcpToolReplExposed;
    /**
     * 该工具是否「裸名 MCP」（`isBare`，无 `mcp__` 前缀）—— 两个调用点（callTool 的白名单门、
     * checkPermission 的内置工具门）共用一份判定，避免将来再次分叉。
     *
     * 判定会打到 `describeForSession` → `loadScopedTools`（异步加载 scoped MCP，可抛），
     * 所以必须接住异常；但**接住之后不能替调用方决定方向** —— 两个调用点的 fail 方向相反，
     * 详见 {@link BareMcpResolution}。上一版在这里 `catch → return true`（把「判不出来」和
     * 「确实是 MCP」压成同一个布尔），对 callTool 是对的、对 checkPermission 是放行，
     * 被安全走查抓出（#128343 回归）。
     */
    private resolveIsBareMcpTool;
    private describeScopedMcpTool;
}
