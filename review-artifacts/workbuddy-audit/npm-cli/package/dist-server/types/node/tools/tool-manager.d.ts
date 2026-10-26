import { Deferred, type Provider } from '@celljs/core';
import { CheckpointService, FileTrackService } from '@genie/cbc-checkpoint';
import { BackgroundTask, PromptRenderer, type Session, SessionHookManager, SessionManager, SessionStore, type ToolCallLoopGuard as ToolCallLoopGuardInterface } from '../../vendor/cbc-core/node/index.js';
import { type FunctionCallItem, RunContext } from '../../vendor/cbc-shared/node/index.js';
import { Agent as ProductAgent, Command, ProductManager, Skill } from '@genie/product';
import { EventService, Logger } from '@genie/telemetry';
import { AcpContext } from '../acp/acp-kernel-protocol';
import { CliRuntimeOptions } from '../cli/cli-runtime-options';
import { ConsoleManager } from '../console';
import { DeferredToolsDescriptionBuilder } from '../context/deferred-tools-description-builder';
import { IDEEditManager } from '../ide-integration/ide-edit-manager';
import { McpPluginRegistry } from '../mcp/mcp-plugin-registry';
import { ConditionalRulesService } from '../memory';
import { type IPrewarmStateService } from '../prewarm/prewarm-protocol';
import { type SecurityReviewGate as SecurityReviewGateInterface } from '../security-review/protocol';
import { type SensitiveToolEgressGuard as SensitiveToolEgressGuardInterface } from '../sensitive-content';
import { SettingsManager } from '../settings/settings-protocol';
import { StartupProfiler } from '../telemetry';
import { type ToolControlPolicy as ToolControlPolicyService } from '../tool-control';
import { type SandboxWriteRuleGuard as ISandboxWriteRuleGuard } from './sandbox-write-rule-guard';
import { type BackgroundWriteIsolationGuard as IBackgroundWriteIsolationGuard, SessionViewRenderInputs, Tool, ToolExecutionError, ToolHookManager, ToolManager, type ToolPermissionService as ToolPermissionServiceInterface } from './tool-protocol';
import { type ExecutionApprovalAdapter as ExecutionApprovalAdapterInterface, type ToolRiskReviewService as ToolRiskReviewServiceInterface } from './tool-risk-review';
import { ToolSearchService } from './tool-search-protocol';
export declare function projectMultitaskAgentParameters(parameters: unknown): unknown;
/**
 * Skill 列表截断元数据。
 *
 * 模板({@link ../../build/patches/cli-saas/templates/tool-skill-description.tpl})**只消费 omittedCount**
 * (渲染为 `Omitted skills: N.`)；truncationMode / totalCount / shownCount / scanDirs 均只用于
 * [SkillToolDescription] 调试日志与运行时观测，不进入 <available_skills>。改动模板渲染面时以
 * omittedCount 为准，其余字段视作"仅日志"。
 *
 * truncationMode（仅日志/观测，不参与渲染）:
 *   - 'none': 未截断
 *   - 'trimmed': description 均分截断,name+部分描述全渲染
 *   - 'names-only': non-protected 降为仅 name(description 空串)
 *   - 'overflow': 有完整条目被丢弃(user 级超 MAX_TOTAL_SKILLS 或最小结构仍超预算)
 */
interface SkillsOverview {
    /** @deprecated 仅日志/观测：模板不再读取，改用 omittedCount 判定省略 */
    truncationMode: 'none' | 'trimmed' | 'names-only' | 'overflow';
    /** skill 原始总数（仅日志/观测） */
    totalCount: number;
    /** 模板中实际渲染的条目数（仅日志/观测） */
    shownCount: number;
    /** 被完全省略的条目数(> 0 时模板渲染 `Omitted skills: N.`)——**模板唯一消费字段** */
    omittedCount: number;
    /** @deprecated 仅日志/观测：目录已内联为 `skills under folder` 分组行，模板不再读取 scanDirs */
    scanDirs: {
        path: string;
        source: string;
    }[];
}
/**
 * 按来源分组的 skill 渲染单元,对齐 tool-skill-description.tpl 的
 * `skills under folder: <folder>` 分组格式(#124001 / #153672)。folder 语义:
 *   - 内置技能(应用包内置 + `workbuddy-builtin` 市场插件的四种布局) → {@link SKILL_FOLDER_WORKBUDDY_BUILTIN}
 *   - 非内置插件 → 插件根目录(`.../plugins/cache/<市场>/<插件>` 或本地市场插件根)
 *   - 平铺来源(project/user/connector/会话注入) → 扫描根目录,一个来源一行
 *   - 无文件系统路径的内置命令 skill → {@link SKILL_FOLDER_BUILTIN} 兜底
 */
interface SkillGroup {
    folder: string;
    skills: (Skill & {
        truncatedDescription?: string;
    })[];
}
interface AgentsOverview {
    truncationMode: 'none' | 'overflow';
    totalCount: number;
    shownCount: number;
    omittedCount: number;
}
export declare class ToolManagerImpl implements ToolManager {
    protected readonly toolProvider: Provider<Tool>;
    protected readonly prewarmState?: IPrewarmStateService;
    protected readonly productManager: ProductManager;
    protected readonly promptRenderer: PromptRenderer;
    protected readonly toolHookManager: ToolHookManager;
    protected readonly sandboxWriteRuleGuard?: ISandboxWriteRuleGuard;
    protected readonly sensitiveToolEgressGuard?: SensitiveToolEgressGuardInterface;
    protected readonly toolCallLoopGuard?: ToolCallLoopGuardInterface;
    protected readonly bgWriteIsolationGuard?: IBackgroundWriteIsolationGuard;
    protected readonly sessionStore: SessionStore;
    protected readonly sessionManager: SessionManager;
    protected readonly cliRuntimeOptions: CliRuntimeOptions;
    protected readonly checkpointService: CheckpointService;
    protected readonly fileTrackService: FileTrackService;
    protected readonly logger: Logger;
    protected readonly consoleManager: ConsoleManager;
    protected readonly ideEditManager: IDEEditManager;
    protected readonly conditionalRulesService: ConditionalRulesService;
    protected readonly sessionHookManager: SessionHookManager;
    protected readonly startupProfiler: StartupProfiler;
    protected readonly toolSearchService: ToolSearchService;
    protected readonly deferredToolsDescriptionBuilder: DeferredToolsDescriptionBuilder;
    protected readonly eventService: EventService;
    protected readonly mcpPluginRegistry?: McpPluginRegistry;
    protected readonly acpContext?: AcpContext;
    protected readonly settingsManager: SettingsManager;
    protected readonly toolControlPolicy?: ToolControlPolicyService;
    protected toolPermissionService?: ToolPermissionServiceInterface;
    protected readonly toolRiskReviewService?: ToolRiskReviewServiceInterface;
    protected readonly securityReviewGate: SecurityReviewGateInterface;
    protected readonly executionApprovalAdapter?: ExecutionApprovalAdapterInterface;
    protected readonly toolMap: Map<string, Tool<any, unknown>>;
    private readonly dynamicToolNames;
    registryVersion: number;
    protected readonly backgroundTasks: Map<string, BackgroundTask>;
    private slashCommandCharBudgetOverride?;
    private skillDescMaxOverridesOverride?;
    private lastInvalidSlashCommandCharBudget?;
    private lastInvalidSkillDescMaxOverrides?;
    /** Live-read by each description build so prewarm activation sees session env. */
    protected get slashCommandCharBudget(): number;
    /** An explicit instance override takes precedence over environment resolution. */
    protected set slashCommandCharBudget(value: number);
    protected readonly skillCharBudget: number;
    protected readonly agentToolCharBudget: number;
    /**
     * Live-read by each Skill description build. The build captures this map once and shares
     * it across protection and hard-cap decisions, avoiding repeated parsing or invalid logs.
     */
    protected get skillDescMaxOverrides(): Map<string, number>;
    /** An explicit instance override takes precedence over environment resolution. */
    protected set skillDescMaxOverrides(value: Map<string, number>);
    /** Promise that resolves when all deferred tools are indexed */
    protected deferredToolsIndexed: Deferred<void>;
    /** Cache for tool descriptions, keyed by tool name */
    protected toolDescriptionCache: Map<string, string>;
    /** 上一次生效的 skillOverrides 指纹，用于门控：仅在 skillOverrides 真变化时才刷新 agent tools。 */
    protected lastSkillOverridesFp?: string;
    protected init(): void;
    /**
     * Index deferred tools based on product.tools configuration.
     * The deferLoading config comes from product.tools, not from tool class properties.
     */
    protected indexDeferredToolsFromProductConfig(): Promise<void>;
    /**
     * 解析当前进程的 --tools / overlay 上下文。优先从 CliRuntimeOptions（cli-dispatcher
     * 在启动早期就 set 进去，进程级单例）读取——这条路径同时覆盖 TUI / print / ACP。
     * Session 路径作为后备（理论上 SessionMiddleware 会规范化 body.tools 写到 session.options，
     * 但实际数据流里它常常是空的，因为 --tools 不会被 RequestBuilder 自动塞进每个 ACP body）。
     *
     * 返回的 names 已剥离 Defer/NoDefer 修饰，overlay 已经过 augmentParsedSpecsForDefer
     * 自动附加（写了 Defer(...) 时自带 ToolSearch + DeferExecuteTool）。
     */
    private resolveSessionToolContext;
    /**
     * 计算当前进程对 ToolSearch 描述的影响指纹，用作 cacheKey 后缀。
     *
     * 没有 --tools / overlay 时返回空串，等同于老 cacheKey（不破坏未使用本特性的会话缓存）。
     */
    private computeSessionDescriptionFingerprint;
    /**
     * 幂等懒索引：当 session overlay 强制让某个内置工具变成 defer
     * （`Defer(Glob)`），但 product 配置里它本来不是 defer 时，第一次出现就把它
     * 注册到 ToolSearchService，后续 session 直接复用进程级索引。
     *
     * 仅作用于内置工具（toolMap 里有的）；MCP 工具走 mcp-manager 自身的索引路径。
     * 已索引时直接返回 false，调用方据此可短路 logger。
     */
    ensureBuiltinDeferIndexed(toolName: string): Promise<boolean>;
    listDynamicToolNames(): string[];
    register(tool: Tool): Promise<void>;
    unregister(name: string): Promise<void>;
    private compileToolInputValidator;
    private assertValidToolInput;
    /**
     * Snapshot of registered builtin tools. See ToolManager.listRegisteredTools.
     */
    listRegisteredTools(): Map<string, Tool>;
    /**
     * Index a deferred tool for search capability.
     * Uses a short summary (first paragraph) of the rendered description for ToolSearch prompt injection.
     * The full description is stored for search matching and returned by ToolSearch results.
     */
    indexDeferredTool(tool: Tool): Promise<void>;
    /**
     * Adapt a deferred tool's {@link Tool.isEnabled} into a no-arg check for the
     * ToolSearch index. Returns undefined when the tool has no dynamic gating
     * (isEnabled absent or literal true) so the service keeps it unconditionally.
     * Evaluated without a session — builtin deferred tools' checks read
     * product/env, not the run context.
     */
    private buildDeferredToolEnabledCheck;
    get(name: string, agentConfig?: ProductAgent, cachedProductConfig?: {
        agents?: any[];
        models?: any[];
        skills?: any[];
        commands?: any[];
        tools?: any[];
    }): Promise<Tool | undefined>;
    protected getToolDescriptionFromProduct(name: string, agentConfig?: ProductAgent, cachedProductConfig?: {
        agents?: any[];
        models?: any[];
        skills?: any[];
        commands?: any[];
        tools?: any[];
    }): Promise<string | undefined>;
    /**
     * session-agent-view 的清单渲染入口（ToolManager 接口文档见 tool-protocol）。
     * 与进程级构建走同一条渲染管线保证同源；差异只有两点：会话档输入按值合并、
     * 结果不进 toolDescriptionCache——会话字节进程程缓存即跨会话泄漏。
     */
    renderSessionToolDescription(name: string, agentConfig: ProductAgent | undefined, inputs: SessionViewRenderInputs, cachedProductConfig?: {
        agents?: any[];
        models?: any[];
        skills?: any[];
        commands?: any[];
        tools?: any[];
    }): Promise<string | undefined>;
    /**
     * 模式级描述覆盖判据（getToolDescriptionFromProduct 早退分支的共享谓词）：
     * REPL×ptc/minimal、minimal/multitask 覆盖表命中。表驱动——覆盖表加条目
     * 自动生效；新增第四种覆盖**机制**须同步本谓词与进程路径分支。
     */
    protected isModeOverriddenDescription(name: string, agentConfig?: ProductAgent): boolean;
    sessionToolsDescriptionFingerprint(session: Session): string;
    /**
     * 出站 A2A 目录指纹（接口文档见 tool-protocol）。归一化与下方
     * A2AGetAgentCard 渲染分支同源：取模板消费的 agentId + name + description
     * （agentId 是渲染进 <available_A2A_agents> 的 `[id]`，issue #114840——
     * 它可在 name/description 不变时随端点 url 变化而变，故必须入指纹，否则
     * 会话源路径复用旧缓存会渲染出失效 `[id]`）。目录序即 registry 序
     * （register 整体置换，变更间稳定）。带 session 时经 resolveView 解析
     * 会话目录（会话源分区 / 进程目录），纯查表不触发 discovery——未拉取的
     * 会话源指纹为空，拉取落地后换值、视图随之重建。
     */
    a2aAgentsDescriptionFingerprint(session?: Session): string;
    /**
     * 描述渲染本体（缓存无关）。进程级路径（getToolDescriptionFromProduct）与
     * 会话视图路径（renderSessionToolDescription）共用。
     *
     * sessionView 缺省 = 进程档渲染：刻意**不做** ALS 会话档合并——进程级构建
     * 可能落在某个会话的 run 里（refreshAgentTools 经 ensureAgentToolsFreshForRun
     * 触发），ALS 合并会把该会话的技能/命令字节写进进程全局缓存与 agent.tools
     * （跨会话泄漏）。会话档清单一律经 sessionView 显式入参（session-agent-view
     * 构建，结果只挂在会话视图上）。
     */
    protected renderToolDescriptionFromProduct(name: string, agentConfig?: ProductAgent, cachedProductConfig?: {
        agents?: any[];
        models?: any[];
        skills?: any[];
        commands?: any[];
        tools?: any[];
    }, sessionView?: SessionViewRenderInputs): Promise<string | undefined>;
    /**
     * 获取允许模型驱动调用的内置命令（disableModelInvocation 不为 true 的）
     */
    protected getModelDrivableBuiltinCommands(): Command[];
    /**
     * 根据字符预算截断自定义命令列表
     *
     * @param commands 完整的命令列表（包含自定义和非自定义命令）
     * @returns
     *   - customCommands: 所有自定义命令（完整列表，未截断，但已过滤 disableModelInvocation）
     *   - truncatedCustomCommands: 截断后的自定义命令（在字符预算内）
     */
    protected truncateCommandsByCharBudget(commands: Command[]): {
        customCommands: Command[];
        truncatedCustomCommands: Command[];
    };
    protected truncateAgentsByCharBudget(agents: ProductAgent[]): {
        agents: (ProductAgent & {
            truncatedDescription?: string;
        })[];
        overview: AgentsOverview;
    };
    protected formatAgentForBudget(agent: ProductAgent, description: string): string;
    /**
     * 根据字符预算截断 skill 描述列表，并按目录分组产出模板渲染结构(#124001)
     *
     * 分层策略(cbc 扩展,超越 CC 对 10000+ skills 场景的支持):
     *
     *   A. Protected 类(source ∈ {'bundled', 'builtin'}，或宿主显式配置了单条上限):
     *      不参与总预算二次均分，保留经 per-entry 上限(默认 200)截断后的 description
     *   B. Non-user 非 protected 类(source ∈ {'project', 'plugin', 'connector'}): 全量加载,
     *      不受条数限制,description 按三阶段截断(均分/names-only)
     *   C. User 级(source === 'user'): 条数限制
     *      - 累计总数(含前面 A+B 所有条目)超过 MAX_TOTAL_SKILLS(200) 后不再加入
     *      - 超限的 user skill 按原始顺序从渲染列表中剔除,计入 omittedCount
     *      - 入选的 user skill 的 description 与 B 一起按三阶段均分截断
     *
     * Description 截断对 B+C 组合(即 rest,非 protected) 三阶段处理:
     *   - 全量试算: 总字符(固定提示 + 目录分组行 + 条目) <= budget 直接全返
     *   - 均分切分: maxDescLen = (剩余预算 - 固定结构 - protected 描述 - rest 开销) / rest.length
     *     - >= 20: truncate(desc, maxDescLen) + '…'
     *     - < 20: rest 降 names-only (truncatedDescription='')
     *
     * names-only 后若最小结构(固定提示 + 目录行 + 每条 `- <name>:` + 省略行)仍超预算，
     * 才从尾部按稳定顺序省略完整条目，直到落入预算；被省略条数计入 omittedCount，
     * 模板在 </available_skills> 前渲染 `Omitted skills: N.`。已渲染 skill 的 name 始终保留。
     *
     * @param skills 完整的 skill 列表
     * @returns {skills, groups, overview}: skills 带 truncatedDescription;groups 为按目录分组的
     *          渲染单元(供模板消费);overview 含 totalCount/shownCount/omittedCount/truncationMode/scanDirs
     */
    protected truncateSkillsByCharBudget(skills: Skill[]): {
        skills: (Skill & {
            truncatedDescription?: string;
        })[];
        groups: SkillGroup[];
        overview: SkillsOverview;
    };
    /**
     * 从截断决策(每条 skill 的最终 description)装配按目录分组的渲染结果 + overview。
     * 目录首现顺序稳定，组内保持入参顺序；flat skills 由 groups 派生(仅调试/兼容，模板只读 groups)，保证与模板消费的
     * groups 完全一致。目录下条目被尾部省略至 0 时该目录分组自然消失(#124001)。
     */
    protected buildSkillResult<E extends {
        skill: Skill;
    }>(entries: E[], descOf: (e: E) => string, mode: SkillsOverview['truncationMode'], totalCount: number, omittedCount: number): {
        skills: (Skill & {
            truncatedDescription?: string;
        })[];
        groups: SkillGroup[];
        overview: SkillsOverview;
    };
    /**
     * 推导 skill 的来源分组目录（用于 `skills under folder` 分组，#153672）。
     *
     * 分组键是「技能来源」而不是「SKILL.md 的物理父目录」：
     *   - 应用包内置副本（source='bundled'）与 workbuddy-builtin 市场插件统一归入
     *     {@link SKILL_FOLDER_WORKBUDDY_BUILTIN}——缓存多技能/单技能(`skill-*`)/
     *     同一插件双布局/应用包副本都收敛成一行；
     *   - 非内置插件截到插件名层：缓存布局去掉版本层与 `skills`/`experts` 层，
     *     本地市场布局去掉版本层；
     *   - 平铺来源（project/user/connector/会话注入）直接用扫描根目录，一个来源一行；
     *   - 无文件系统路径的内置命令 skill 仍归入 {@link SKILL_FOLDER_BUILTIN}，不并入内置组。
     */
    protected skillFolder(skill: Skill): string;
    /**
     * 内置技能判定：应用包内置副本按 source；内置市场插件按市场名；
     * 市场名缺失（旧数据）时按真实路径段 `.../plugins/{cache,marketplaces}/workbuddy-builtin/` 兜底。
     */
    protected isBuiltinSkill(skill: Skill): boolean;
    /** 插件技能的分组目录：缓存布局截到插件层，本地市场/inline 用插件根目录。 */
    protected pluginSkillFolder(skill: Skill): string | undefined;
    /** 取插件缓存布局的插件根：`.../plugins/cache/<市场>/<插件>`（去掉版本与更深的层）。 */
    protected pluginCacheFolder(p: string): string | undefined;
    /**
     * 取本地市场布局的插件根：`.../plugins/marketplaces/<市场>/plugins/<插件>`。
     * 目录市场可以注册在任意绝对路径，故先按 pluginInfo.pluginName 定位任意市场根下
     * 的 `plugins|connectors/<插件>[/<版本>]`（取最深命中）；定位不到时再按约定的
     * `.../plugins/marketplaces/<市场>/plugins/<插件>` 布局截断。
     */
    protected marketplacePluginFolder(p: string, pluginName?: string): string | undefined;
    /**
     * 内置市场路径兜底：市场名缺失（旧安装记录 / 直接注入）时按真实目录判定。
     * 只认以下几种实际布局，避免把恰好叫 `workbuddy-builtin` 的普通文件夹并入内置组：
     *   - 插件缓存：`.../plugins/cache/workbuddy-builtin/<插件>/...`
     *   - 市场根：`.../plugins/marketplaces/workbuddy-builtin/...`
     *   - 应用包内置市场根：`.../resources/plugins/workbuddy-builtin/...`
     *   - 应用包 legacy 根：`.../resources/builtin-plugins/<插件>/...`
     */
    protected isBuiltinMarketplacePath(p: string): boolean;
    /** 目录可用：非空、非文件系统根、非纯盘符。 */
    protected isUsableDirectory(p: string): boolean;
    /** 插件根候选：优先 pluginRoot，其次 baseDirectory，最后 location 的父级。 */
    protected skillPluginRoot(skill: Skill): string;
    /** 去掉路径末尾分隔符；根路径返回空串（由调用方按兜底处理）。 */
    protected trimTrailingPathSeparators(p: string): string;
    /**
     * 旧版分组推导：技能位于其自身子目录下时取父级。仅在来源信息缺失时兜底；
     * 父级恰为文件系统根（`/` 或纯盘符 `C:`）时归入 `(built-in)`，避免噪声标签
     * (#127746 CR minor)。
     */
    protected legacySkillFolder(skill: Skill): string;
    /** 取路径父级，兼容 `/` 与 `\\` 分隔符；无分隔符(非路径，如 'bundled')返回空串。 */
    protected parentPath(p: string): string;
    /**
     * 返回 user-level skill 扫描目录路径,保留供调试/日志使用(目录已内联为分组行)。原用于告诉模型"超出 MAX_TOTAL_SKILLS 上限的
     * user skill 可在此目录下自行发现(子目录名即 skill 名)"
     *
     * 注意: 仅包含 user 级目录,不含 project/connector/bundled — 后三者在 cbc 实现中被全量加载进模板,
     * 告诉模型去扫描它们反而误导(会让模型以为"这里还有更多"而事实上已全列)。只有 user 级 skills 受
     * MAX_TOTAL_SKILLS 条数限制可能溢出,才需要 scanDir 发现出口。
     */
    protected getSkillScanDirs(): {
        path: string;
        source: string;
    }[];
    /**
     * 判断 skill 是否属于 "protected" 类 — 不参与总预算二次截断
     *
     * 对齐 Claude Code "bundled skills never truncated" 设计意图:
     * - 'bundled': skill-product-provider.ts:96 扫描 builtin skills 目录赋值
     * - 'builtin': tool-manager.ts 把 cbc 内置命令(/help /model 等)包装为 skill 时赋值
     * - 宿主通过 CODEBUDDY_SKILL_DESC_MAX_OVERRIDES 显式配置的 skill：保留其经指定
     *   单条上限截断后的描述。这样同一内置 skill 被市场更新到 plugin cache 后不会因
     *   source 变化重新参与总预算均分。
     *
     * 未显式配置覆盖值的 'user'/'project'/'connector'/'plugin' 均参与均分截断。
     */
    protected isProtectedSkill(skill: Skill, overrides?: Map<string, number>): boolean;
    /**
     * 解析单个 skill 的 per-entry description 硬帽字符数。
     *
     * 默认返回全局 {@link MAX_SKILL_DESC_CHARS}(200)；若该 skill 名命中
     * {@link SKILL_DESC_MAX_OVERRIDES_ENV} 注入的覆盖表，则返回覆盖值（完全替换默认，
     * 既可放宽也可收紧，由宿主注入意图决定）。此帽对所有 source（含 protected 的
     * bundled/builtin）一视同仁地作用在 Stage 1。
     */
    protected resolveSkillDescCap(skill: Skill, overrides?: Map<string, number>): number;
    /**
     * 硬截断字符串到指定字符数,超出时尾部用 U+2026 省略号标记
     */
    protected hardCap(text: string, max: number): string;
    /**
     * 格式化命令为描述文本（用于计算字符数）
     * 必须与模板中的格式保持一致
     *
     * 格式: - /command-name <args>: description
     */
    protected formatCommandForBudget(command: Command): string;
    /** Resolve the current slash-command character budget when a description is built. */
    protected resolveSlashCommandCharBudget(): number;
    /**
     * 初始化 Skill 工具字符预算。
     *
     * 该预算是 `<available_skills>` **列表整体**的硬上限，覆盖标签内部的目录分组行
     * (`skills under folder: ...`) + 每条 `- name: desc` + 末尾可选 `Omitted skills: N.`，
     * 不含标签外的固定说明散文。超出后按 truncateSkillsByCharBudget 逐级收敛
     * (per-entry cap → 均分缩短 → names-only → 尾部省略)。
     *
     * 预算**恒为 {@link DEFAULT_SKILL_TOOL_CHAR_BUDGET}(8000)、写死不可配**：故意忽略
     * 宿主/环境注入的 CODEBUDDY_SKILL_TOOL_CHAR_BUDGET 与 SLASH_COMMAND_TOOL_CHAR_BUDGET
     * (例如 WorkBuddy 曾注入 30000)，保证任何运行环境下 `<available_skills>` 列表体上限
     * 一致，不因宿主放宽而膨胀 (需求方 annelywu 确认写死 8000，#124001)。
     */
    protected initSkillCharBudget(): number;
    /**
     * 运行时解析 per-skill description 硬帽覆盖表。
     *
     * 从 {@link SKILL_DESC_MAX_OVERRIDES_ENV} 解析 JSON 对象（skill 名 → 字符上限）；未设置或
     * 全部非法时返回空表（此时所有 skill 走全局 {@link MAX_SKILL_DESC_CHARS} 默认）。设置了非空值
     * 但解析结果为空（JSON 非法 / 非对象 / 无合法项）时 warn 一次，便于宿主排查注入格式问题。
     */
    protected resolveSkillDescMaxOverrides(): Map<string, number>;
    /** TTL for terminal background tasks before automatic eviction from memory. */
    private static readonly BG_TASK_TTL_MS;
    /** Interval between background task cleanup sweeps. */
    private static readonly BG_TASK_CLEANUP_INTERVAL_MS;
    private bgTaskCleanupTimer;
    addBackgroundTask(task: BackgroundTask): void;
    removeBackgroundTask(id: string): void;
    getBackgroundTasks(): BackgroundTask[];
    getBackgroundTask(id: string): BackgroundTask | undefined;
    killBackgroundTask(id: string, options?: {
        suppressNotification?: boolean;
    }): Promise<boolean>;
    killBackgroundTasksBySessionId(sessionId: string): Promise<void>;
    /**
     * Start periodic cleanup of terminal background tasks if not already running.
     * Prevents unbounded growth of the backgroundTasks Map in long-running sessions.
     */
    private ensureBgTaskCleanupStarted;
    /**
     * 已经为「已终态但从未通知」打过警告的任务。用 WeakSet 而不是往协议上加字段：
     * 这是纯粹的日志去重状态，任务对象被回收时自然消失。
     */
    private readonly bgTaskNeverNotifiedWarned;
    /**
     * 回收已经处于终态（completed / failed / killed）且超过 {@link BG_TASK_TTL_MS} 的
     * 后台任务。TTL 内不回收，是为了让模型/用户还能用 TaskOutput 回看结果。
     *
     * 「已终态但从未通知」的任务同样按 TTL 强制回收。以前这类任务被无条件 continue、
     * 永远留在 map 里，而它们并不轻：`task.stdout` / `task.stderr` 两个 TruncateBuffer，
     * 加上 `finalize` 闭包捕获的 handle、session、notifier 和 poller——一个卡住的任务
     * 会把整条 shell 句柄和 session 都留在内存里。这条分支按设计不该走到（本 issue
     * 的目的就是消灭它），但既然代码里存在，就不能留一个无上界的驻留口子。
     */
    private cleanupTerminalBackgroundTasks;
    /** 存活对账的轮询间隔。 */
    private static readonly BG_TASK_RECONCILE_INTERVAL_MS;
    /**
     * 判定「进程已终止」需要连续命中的 tick 数。
     *
     * 用 2 而不是 1，是为了压掉单次探测的瞬时抖动（探测恰好落在进程状态切换的窗口里、
     * 或 procfs 读取被打断），代价只是最多多等一个 5 秒周期。
     *
     * 注意它**压不住 pid 复用**，别误解这个常量的作用：pid 被复用时探测会成功，
     * 结论是"还活着"，方向恰好相反——那会导致漏报（任务卡着不自愈），而不是误报终态。
     * 整条对账链路的偏置一律如此：宁可漏报，不可误报。
     */
    private static readonly BG_TASK_RECONCILE_CONFIRMATIONS;
    private bgTaskReconcileTimer;
    /**
     * 连续命中计数。用 WeakMap 而不是往协议上加字段：这是纯粹的对账内部状态，
     * 任务对象被回收时计数自然消失。
     */
    private readonly bgTaskTerminatedTicks;
    /**
     * 后台任务存活对账。
     *
     * 为什么需要：后台任务的终态判定原本完全依赖一次性的进程终止事件，而线上实测
     * 约 11% 的子进程收不到这个事件（#92382）。事件是可能丢的，而「进程还在不在」
     * 是可以反复查询的权威状态——这个循环就是用后者兜住前者。事件到了走快路径
     * （毫秒级），事件丢了由这里在一个周期内自愈。
     *
     * 只对提供了 `probeTerminated` 的任务生效（目前是 Bash 后台任务）；workflow /
     * agent / teammate 任务没有底层进程可探，自然跳过。
     */
    private ensureBgTaskReconcileStarted;
    /**
     * 对账的单轮判定。任何一步不满足就重置计数，避免"断续命中"累积成误判。
     */
    private reconcileBackgroundTasks;
    private getPlainToolInput;
    private authorizeToolEgress;
    /**
     * Final deny backstop for tools with inherited restrictions (e.g. ViewImage ← Read).
     * Resolved on the post-hook, post-transform arguments immediately before execution;
     * throws when they still match a deny rule. Interactive approval was already handled
     * by needsApproval (which re-checks the rewritten input), so ask does not block here.
     */
    private enforceInheritedRestrictionDeny;
    /**
     * Execute a tool with PreToolUse and PostToolUse hooks
     * Claude Code compatible implementation
     */
    protected executeToolWithHooks(tool: Tool, originalExecute: (...args: any[]) => any, input: any, context?: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }, inputFormat?: 'legacy' | 'parsed'): Promise<any>;
    private doExecuteToolWithHooks;
    private authorizeFinalToolAction;
    private getExecutionApprovalAdapter;
    private recordToolRiskExecutionStatus;
    private recordToolRiskBuiltinCall;
    private recordToolRiskBuiltinResult;
    /**
     * Try to intercept tool execution
     * Priority chain: ACP > Local
     *
     * Note: IDE input transformation is handled separately before tool execution
     */
    private tryInterceptTool;
    /**
     * Try ACP interception (existing logic)
     */
    private tryAcpIntercept;
    /**
     * Check if IDE has transformed the input arguments
     * Returns transformed input if available, or null for normal execution
     *
     * Based on Claude Code's pattern but simplified:
     * - IDE doesn't execute the tool, only transforms arguments
     * - tool-manager handles actual execution with transformed arguments
     */
    private checkIdeInputTransformation;
    private appendAdditionalContextToToolResult;
    private appendTextToToolContent;
    private appendTextBlockToContentArray;
    private tryParseImageContentArray;
    private containsImageContentBlock;
    private isImageContentBlock;
    /**
     * Extract raw response from ToolResult for hook usage
     * Ensures Claude Code hooks receive the correct tool_response format
     */
    private extractRawResponse;
    /**
     * Public entry for the REPL/Code Mode sandbox execution path
     * (DeferExecuteTool.routeToolCall → executeBuiltinTool), which bypasses the
     * {@link executeToolWithHooks} wrapper that normally performs the pre-execute
     * backup. Delegates to the same {@link createFileBackupBeforeExecute} logic so
     * sandbox-internal Edit/Write also produce a FileHistorySnapshotItem and rewind
     * can restore them (#130664). Idempotent via FileTrackService.trackFile.
     */
    trackFileForToolCall(toolName: string, toolInput: unknown, session: Session, details?: {
        toolCall: FunctionCallItem;
    }): Promise<string | undefined>;
    /**
     * Create file backup before tool execution.
     * Returns the tracked file path if a file was tracked, undefined otherwise.
     */
    protected createFileBackupBeforeExecute(toolName: string, toolInput: any, session: Session, details?: {
        toolCall: FunctionCallItem;
    }): Promise<string | undefined>;
    /** 把写前备份的定位结果交给同一次调用里的文件工具，由它写进 DiffChange（#156509）。 */
    private recordFileChangeBackupOutcome;
    private describeFileChangeBackup;
    /**
     * 写前 checkpoint 只支持常规文件。stat 跟随符号链接，所以指向常规文件的链接保持
     * 既有可编辑语义；目录和其它特殊文件在进入备份链路前就以路径参数错误终止。
     */
    protected assertCheckpointSourceIsFileOrMissing(toolName: string, filePath: string): Promise<void>;
    protected createFilePathTypeError(toolName: string, filePath: string, kind: 'directory' | 'special' | 'invalid'): ToolExecutionError;
    protected createCheckpointBackupFailedError(toolName: string, filePath: string, error: unknown): ToolExecutionError;
    /**
     * Inject conditional rules for file operation tools
     */
    protected injectConditionalRules(toolName: string, toolInput: any, session: Session, toolResult: any): Promise<void>;
    /**
     * Setup callback for delegate tool manager to notify when tools change
     * This enables dynamic refresh of DelegateTool description and updates running agents
     */
    protected setupDelegateToolManagerCallback(): void;
    /**
     * Setup callback for the A2A agent registry to notify when the discovered
     * outbound-agent set changes (lazy discovery against
     * CODEBUDDY_REMOTE_AGENTS_URL lands, or a re-discovery replaces it).
     * Mirrors {@link setupDelegateToolManagerCallback}: invalidate the
     * A2AGetAgentCard description cache (its `<available_A2A_agents>` block is
     * derived from the registry) then refresh all running agents so the block
     * is rebuilt for the next model request. Only the A2AGetAgentCard
     * description embeds the list — the other 3 A2A tools reference `agent_name`
     * but do not enumerate agents, so they need no invalidation.
     */
    protected setupA2aRegistryCallback(): void;
    /**
     * settings 变更时的 skillOverrides 反应性处理：仅在合并后的 skillOverrides **实际变化**时，
     * 失效 SKILL 工具描述缓存并刷新所有已构建 agent 的 tools，使当前会话立即用新 overrides 重建
     * <available_skills>（描述已物化进 agent.tools，只失效缓存不足以刷新在跑的 agent）。
     * 指纹门控避免换主题/权限批准等无关 settings 写入触发全量刷新。
     */
    protected handleSkillOverridesChange(): Promise<void>;
    /**
     * Invalidate cached tool description (used by delegate tool manager when tools change)
     */
    invalidateCachedToolDescription(toolName: string): void;
    /**
     * Invalidate all tool description caches that depend on plugin-contributed data
     * (skills / commands / agent tools list). Call this after any plugin state change
     * (install / uninstall / enable / disable / switch / refresh / plugin agent override),
     * otherwise the next LLM request may carry a stale `<available_skills>`, slash
     * command list, or Agent tool subagent list rendered before the plugin was loaded.
     *
     * Currently covers: Skill, SlashCommand, ToolSearch, Agent.
     */
    invalidatePluginDependentToolCaches(): void;
    /**
     * 上报 MCP 工具的插件能力调用埋点。
     * 仅对名字符合 `mcp__{serverName}__{toolName}` 且 serverName 登记到
     * {@link McpPluginRegistry} 的工具触发上报。
     * 仅在 WorkBuddy Desktop 宿主下上报。
     */
    private reportMcpToolCapabilityCall;
}
export {};
