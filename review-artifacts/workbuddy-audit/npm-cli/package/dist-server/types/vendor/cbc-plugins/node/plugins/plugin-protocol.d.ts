import { Event } from '@celljs/core';
import type { McpConfig } from '../../../../node/mcp/index.js';
import { SettingsScope } from '../../../../node/settings/settings-protocol.js';
import { MarketplaceConfigItem, ProductConfiguration } from '@genie/product';
/**
 * 市场配置项（带名称）
 * 用于内部处理，将对象结构转换为数组结构
 */
export interface MarketplaceConfigEntry extends MarketplaceConfigItem {
    /** 市场名称 */
    name: string;
}
/**
 * 插件状态枚举
 */
export declare enum PluginStatus {
    /** 已安装但未启用 */
    Installed = "installed",
    /** 已启用 */
    Enabled = "enabled",
    /** 已禁用 */
    Disabled = "disabled"
}
/**
 * 市场类型枚举
 */
export declare enum MarketplaceType {
    /** 本地文件系统 */
    Directory = "directory",
    /** Github仓库 */
    Github = "github",
    /** Git仓库 */
    Git = "git",
    /** HTTP/HTTPS远端 */
    URL = "url",
    /** Zip/Tgz/Tar.gz 归档包（http(s) URL 或本地文件路径） */
    Zip = "zip",
    /** Explicit in-process catalog adapter. */
    Provider = "provider"
}
/**
 * 插件扩展类型
 */
export declare enum PluginExtensionType {
    Agent = "agent",
    Command = "command",
    Skill = "skill",
    MCP = "mcp",
    Hook = "hook",
    LSP = "lsp",
    OutputStyle = "output-style",
    Settings = "settings"
}
/**
 * Provider优先级常量
 */
export declare namespace MarketplaceProviderPriority {
    const Local = 1000;
    const Git = 2000;
    const Http = 3000;
}
/**
 * MCP服务器配置
 */
export interface MCPServerConfig {
    /** 服务器名称 */
    name: string;
    /** 执行命令 */
    command: string;
    /** 命令参数 */
    args?: string[];
    /** 环境变量 */
    env?: Record<string, string>;
}
/**
 * LSP 服务器配置
 */
export interface LspServerConfig {
    /** LSP 可执行命令 (must be in PATH) */
    command: string;
    /** 命令参数 */
    args?: string[];
    /** 文件扩展名到语言 ID 的映射 */
    extensionToLanguage: Record<string, string>;
    /** 通信传输方式 */
    transport?: 'stdio' | 'socket';
    /** 环境变量 */
    env?: Record<string, string>;
    /** 初始化选项 */
    initializationOptions?: any;
    /** 服务器设置 */
    settings?: any;
    /** 工作区路径 */
    workspaceFolder?: string;
    /** 启动超时(毫秒) */
    startupTimeout?: number;
    /** 关闭超时(毫秒) */
    shutdownTimeout?: number;
    /** 崩溃时自动重启 */
    restartOnCrash?: boolean;
    /** 最大重启次数 */
    maxRestarts?: number;
    /** 日志配置 */
    loggingConfig?: {
        /** 是否启用日志 */
        enabled?: boolean;
        /** 日志级别 */
        level?: 'off' | 'messages' | 'verbose';
    };
    /** 是否在注册时立即启动（默认 false，即懒加载模式） */
    eager?: boolean;
}
export type PluginHooksConfig = Record<string, any> | string | Array<Record<string, any> | string>;
/**
 * 插件清单结构 (plugin.json)
 */
export interface PluginManifest {
    /** 插件唯一标识符 */
    name: string;
    /** 插件版本(遵循语义化版本) */
    version?: string;
    /** 插件描述 */
    description?: string;
    /** 作者信息 */
    author?: {
        name: string;
        email?: string;
        url?: string;
    };
    /** 许可证 */
    license?: string;
    /** 插件主页 */
    homepage?: string;
    /** 仓库URL */
    repository?: string;
    /** 关键词 */
    keywords?: string[];
    /** 插件分类 */
    category?: string;
    /** Agent 配置：支持指定的 agent 文件或目录路径 */
    agents?: string[] | string;
    /** Command 配置：支持指定的 command 文件或目录路径 */
    commands?: string[] | string;
    /** Skill 配置：支持指定的 skill 文件或目录路径 */
    skills?: string[] | string;
    /** Hook 配置：支持指定的 hook 配置或文件路径 */
    hooks?: PluginHooksConfig;
    /** Prebuilt browser module; the CBC Web UI separately approves its exact installed source. */
    client?: {
        platform: 'web';
        entry: string;
        format: 'module';
        apiVersion?: 1;
        hostVersion?: string;
    };
    /** Web-authored/distributed host code must not run in another product or ordinary CLI. */
    modHost?: 'web';
    /** MCP 服务器配置：支持指定的 MCP 服务器配置或文件路径 */
    mcpServers?: Record<string, McpConfig> | string;
    /** MCP Bundle 配置：预打包的 MCP 服务（远程 URL 或本地 .mcpb/.dxt 文件） */
    mcpBundles?: McpBundleEntry[];
    /** LSP 服务器配置：支持指定的 LSP 服务器配置或文件路径 */
    lspServers?: Record<string, LspServerConfig> | string;
    /** 插件默认设置（启用时合并到 settings 系统，使用 allowlist 机制） */
    settings?: PluginSettings;
    /** 默认是否启用。显式 false 时安装后保持 disabled，除非依赖解析需要显式启用。 */
    defaultEnabled?: boolean;
    /** Legacy top-level theme 配置；当前 agent-cli 仅识别，不加载到运行时。 */
    themes?: string[] | string;
    /** Legacy top-level monitor 配置；当前 agent-cli 仅识别，不启动 monitor。 */
    monitors?: string | PluginMonitorEntry[];
    /** 实验组件配置，兼容 Claude Code manifest schema。 */
    experimental?: {
        themes?: string[] | string;
        monitors?: string | PluginMonitorEntry[];
        [key: string]: unknown;
    };
    /** Output style 配置：支持指定的 output-style 文件路径 */
    outputStyles?: string[] | string;
    /** 用户配置选项定义（安装时交互式收集） */
    userConfig?: Record<string, PluginUserConfigField>;
    /** 插件依赖列表。字符串默认解析到同 marketplace；对象可声明 version / marketplace。 */
    dependencies?: PluginDependency[];
    /** Portable in-package plugin group. CLI composes ordered JSON layers before PluginManager installs it. */
    bundle?: {
        version: 1;
        layers: Array<{
            name: string;
            plugins: Array<{
                path: string;
                enabled?: boolean;
                options?: Record<string, string | number | boolean | string[]>;
            }>;
        }>;
        lock?: {
            version: 1;
            members: Array<{
                path: string;
                name: string;
                version: string;
                hash: string;
                enabled: boolean;
            }>;
        };
    };
    /** 依赖要求 */
    requirements?: {
        /** Claude Code版本要求 */
        claude_code?: string;
        /** Node.js版本要求 */
        node?: string;
        /** 其他自定义要求 */
        [key: string]: string | undefined;
    };
    /** 功能列表 */
    features?: string[];
    /** 安装命令 */
    installation?: string;
}
/**
 * 市场清单结构 (marketplace.json)
 */
export interface MarketplaceManifest {
    /** Opaque catalog metadata; committed atomically with the complete catalog. */
    metadata?: Record<string, unknown>;
    provider?: string;
    /** 市场名称 */
    name: string;
    /** 市场描述 */
    description?: string;
    /** 所有者信息 */
    owner?: {
        name: string;
        email?: string;
    };
    /** 插件列表 */
    plugins: MarketplacePluginEntry[];
    /**
     * 允许自动安装跨 marketplace 依赖的目标 marketplace 名称列表。
     * 仅 root marketplace 的 allowlist 生效，不做传递信任。
     */
    allowCrossMarketplaceDependenciesOn?: string[];
    /** 市场版本 */
    version?: string;
}
/**
 * 插件源类型
 */
export declare enum PluginSourceType {
    /** 本地相对路径 */
    Local = "local",
    /** An immutable remote ZIP package, independent of its marketplace catalog. */
    Archive = "archive",
    Provider = "provider",
    /** Git仓库 */
    Github = "github",
    /** Git URL */
    Url = "url",
    /** npm 包 */
    Npm = "npm",
    /** pip 包 */
    Pip = "pip",
    /** Git 仓库子目录 */
    GitSubdir = "git-subdir"
}
/**
 * 插件源配置
 */
export interface PluginSource {
    provider?: string;
    /** 源类型 */
    source: PluginSourceType;
    /** Exact local package snapshot fingerprint; install/cache identity never reuses changed bytes. */
    contentHash?: string;
    /** SHA256 of the original ZIP bytes (archive source only). */
    sha256?: string;
    /** Git URL (source为url时使用) */
    url?: string;
    /** github 仓库 */
    repo?: string;
    /**
     * 路径字段，含义随 `source` 不同：
     * - `source === 'local'`: 本地相对路径（相对于 marketplace 根目录）
     * - `source === 'git-subdir'`: Git 仓库内子目录路径（官方 claude-plugins 规范字段名）
     *
     * 对于 git-subdir，`path` 与历史字段 `subdir` 等价且优先级更高。
     */
    path?: string;
    /** npm 包名 (source为npm时使用) */
    package?: string;
    /** 版本约束 (npm/pip) */
    versionConstraint?: string;
    /** 自定义 registry (npm) */
    registry?: string;
    /** Git 仓库子目录路径 (source为git-subdir时使用) */
    subdir?: string;
    /**
     * Git 分支或标签名（source为git-subdir时使用）
     * 默认使用仓库的默认分支
     */
    ref?: string;
    /**
     * 锁定的 Git 提交 SHA（source为git-subdir时使用）
     * 完整 40 字符 SHA，优先级高于 `ref`
     */
    sha?: string;
}
/**
 * 市场中的插件条目
 */
export interface MarketplacePluginEntry {
    /** 插件名称 */
    name: string;
    /** 插件源路径(相对于市场根目录)或源对象 */
    source: string | PluginSource;
    /** 插件描述 */
    description?: string;
    /** 插件版本 */
    version?: string;
    /** 默认启用状态，优先于 plugin.json 的同名字段。 */
    defaultEnabled?: boolean;
    /** 插件依赖列表。可覆盖/补充 plugin.json 中的 dependencies。 */
    dependencies?: PluginDependency[];
    /** 严格模式(兼容superpowers-marketplace) */
    strict?: boolean;
}
/**
 * 插件依赖声明。
 * - string: 依赖当前 marketplace 中同名插件；兼容历史 name@marketplace 写法
 * - object: 支持 semver range 和显式 marketplace
 */
export type PluginDependency = string | PluginDependencyObject;
export interface PluginDependencyObject {
    /** 依赖插件名称 */
    name: string;
    /** semver range，如 ^1.0.0 / ~2.1.0 / >=1.4 */
    version?: string;
    /** 显式指定依赖所在 marketplace，省略时使用声明方 marketplace */
    marketplace?: string;
}
export interface PluginDependencyError {
    code: 'dependency-unsatisfied' | 'dependency-version-unsatisfied' | 'no-matching-tag' | 'range-conflict' | 'cross-marketplace' | 'invalid-dependency';
    dependency: string;
    dependencyMarketplace?: string;
    required?: string;
    installed?: string;
    message: string;
}
/**
 * 市场源配置（扩展支持 pattern 匹配）
 */
export interface MarketplaceSourceConfig extends MarketplaceSource {
    /** 允许的 host 正则模式（用于 URL 源白名单） */
    hostPattern?: string;
    /** 允许的路径正则模式（用于本地目录源白名单） */
    pathPattern?: string;
    /** 是否启用自动更新 */
    autoUpdate?: boolean;
}
/**
 * 插件信息(扩展清单,包含来源)
 */
export interface PluginInfo extends PluginManifest {
    /** 所属市场名称 */
    marketplaceName: string;
    /** 插件源配置(支持字符串或对象类型) */
    source: string | PluginSource;
    /** 安装状态 */
    status?: PluginStatus;
    /** 安装路径(已安装时) */
    installedPath?: string;
    /**
     * Whether the plugin has an applicable explicit installed_plugins.json
     * record. Inline plugins are the only runtime plugins that may have an
     * installedPath without such a record; Marketplace plugins always run
     * from the immutable cache selected by the registry.
     *
     * @internal
     */
    registryInstalled?: boolean;
    /** Complete local snapshot identity verified during materialization; never inferred from cache path names. */
    installedContentHash?: string;
    installedArchiveSha256?: string;
    /** 安装 scope (user/project/project-local) */
    installScope?: PluginInstallScope;
    /** 用户是否可以删除（卸载）该插件，只有显式 false 才禁止（由管控策略注入） */
    canRemove?: boolean;
    /** 用户是否可以禁用该插件，只有显式 false 才禁止（由管控策略注入） */
    canSwitchoff?: boolean;
    /** 用户是否可以编辑该插件配置，只有显式 false 才禁止（由管控策略注入） */
    canEdit?: boolean;
    /** 当前插件因依赖不满足而被运行时降级/禁用的原因 */
    dependencyErrors?: PluginDependencyError[];
    /** tag 约束解析出的实际版本，优先于 manifest.version 做依赖校验。 */
    resolvedVersion?: string;
    /** Git 来源实际安装的 commit SHA。 */
    gitCommitSha?: string;
    /** 是否作为其他插件的依赖自动安装。 */
    autoInstalled?: boolean;
    /** 是否属于内置市场（从所属 Marketplace 的 isBuiltIn 透传，供客户端隐藏内置插件）。 */
    isBuiltIn?: boolean;
}
/**
 * 市场信息
 */
export interface MarketplaceInfo {
    /** 市场名称 */
    name: string;
    /** 市场存储名称 */
    storageName?: string;
    /**
     * 调用方声明的市场名。安装阶段实例带的是 `source-<hash>-<pid>-<nonce>` staging 名，
     * 按市场身份取数（如内置市场的版本元数据）只能用本字段（#119844）。
     */
    declaredName?: string;
    /**
     * 已验证的 marketplace manifest 名称。
     *
     * `storageName` 是稳定的 registry key，Product / settings 可以用别名将它
     * 绑定到不同的上游 manifest name。单独持久该字段，让只读消费者无需
     * 放宽 identity 校验也能安全解析别名。
     */
    manifestName?: string;
    /** 市场类型 */
    type: MarketplaceType;
    /** 市场源地址 */
    source: MarketplaceSource;
    /** 本地安装地址 */
    installLocation: string;
    /** 市场描述 */
    description?: string;
    /** 更新时间 */
    lastUpdated?: string;
    /** 是否为内置市场 */
    isBuiltIn?: boolean;
    /** 是否启用自动更新 */
    autoUpdate?: boolean;
    /** Explicit user choice; Product defaults must not reset it during reconciliation. */
    autoUpdateSource?: 'user';
}
/**
 * Lightweight result produced before a remote marketplace source is staged.
 *
 * Implementations may use a version pointer, URL version, ETag, or another
 * source-native token. The check runs against the stable, last-good source;
 * it must not download or publish the replacement payload.
 */
export interface MarketplaceUpdatePreparation {
    /** Whether new source bytes must be prepared and published. */
    needsUpdate: boolean;
    /** Diagnostic reason emitted by the source-specific freshness check. */
    reason: string;
    /** Optional version token to commit alongside the published snapshot. */
    remoteVersion?: string;
}
/** How PluginManager seeds the private source transaction directory. */
export type MarketplaceUpdateStagingMode = 'copy' | 'empty';
export interface Marketplace extends MarketplaceInfo {
    /** Last successfully loaded marketplace manifest, when one is available. */
    manifest?: MarketplaceManifest;
    /**
     * Complete-snapshot sources can start from an empty transaction directory.
     * Incremental/custom implementations default to copying the last-good tree.
     */
    readonly updateStagingMode?: MarketplaceUpdateStagingMode;
    init(marketplaceInfo: MarketplaceInfo): void;
    install(onProgress?: ProgressCallback): Promise<void>;
    /**
     * Optionally check freshness against the stable source before PluginManager
     * creates a private staging directory.
     */
    checkForUpdate?(onProgress?: ProgressCallback): Promise<MarketplaceUpdatePreparation>;
    /**
     * Refresh the marketplace source. `false` means the source was checked and
     * is already current; `true` means new source bytes were published.
     * Legacy/custom implementations may return void, which callers treat as
     * changed for backward compatibility.
     *
     * `preparation` is supplied when the caller already checked the stable
     * source. Implementations must not repeat that check against private staging.
     */
    update(onProgress?: ProgressCallback, preparation?: MarketplaceUpdatePreparation): Promise<boolean | void>;
    listPlugins(): Promise<PluginInfo[]>;
    loadManifest(): Promise<void>;
    getPlugin(pluginName: string): Promise<PluginInfo | undefined>;
}
export interface MarketplaceSource {
    provider?: string;
    source: MarketplaceType;
    path?: string;
    repo?: string;
    url?: string;
}
/**
 * 插件内容(安装时获取的完整内容)
 */
export interface PluginContent {
    /** 插件清单 */
    manifest: PluginManifest;
    /** 文件映射: 相对路径 -> 文件内容 */
    files: Map<string, string | Buffer>;
}
/**
 * 进度回调函数类型
 */
export type ProgressCallback = (message: string) => void;
/**
 * 市场添加选项
 */
export interface MarketplaceAddOptions {
    /** 市场名称 */
    name?: string;
    /** 进度回调函数 */
    onProgress?: ProgressCallback;
    /** 是否启用自动更新（默认 false） */
    autoUpdate?: boolean;
    /**
     * 是否跳过官方名称保护校验（isBlockedOfficialName / validateOfficialNameSource）
     *
     * 仅供内部信任路径使用（如 `installBuiltInMarketplaces` 读取 product.json 注入
     * 的 builtin marketplace）。product 配置本身即可信源，不应再被名称保护拦截。
     *
     * 用户通过命令行、UI 或 settings 手工添加的市场必须走完整校验，禁止开启此开关。
     */
    bypassNameValidation?: boolean;
    /**
     * 是否强制更新：跳过 `MarketplaceUpdateChecker` 的 short-circuit
     * （url-version / ETag / Last-Modified / mtime throttle），直接下载并覆盖
     * 目标市场目录。
     *
     * 供用户显式要求重新下载或诊断缓存问题时使用。正常自动更新必须由同一个
     * MarketplaceUpdateChecker 判定，不能再叠加一套宿主版本状态机。
     *
     * 仅在 `updateMarketplace` 路径生效；`addMarketplace` 路径忽略。
     */
    force?: boolean;
    /** 内部批量准备流程已在末尾统一修复依赖时跳过单次修复。 */
    skipDependencyResolution?: boolean;
    /** Internal: an explicit plugin update owns the later cache refresh. */
    skipInstalledPluginRefresh?: boolean;
}
/** Internal marketplace object already selected by its exact storage name. */
export interface MarketplaceSelectionOptions {
    marketplace?: Marketplace;
}
export interface MarketplaceUpdateOptions extends MarketplaceAddOptions, MarketplaceSelectionOptions {
    /**
     * Re-materialize plugins already installed from this Marketplace after
     * refreshing its catalog. Manual Marketplace updates leave this false to
     * match Claude Code; background/host upgrade flows opt in explicitly.
     */
    updateInstalledPlugins?: boolean;
}
/**
 * 插件安装选项
 */
export interface PluginInstallOptions {
    /** Fail closed if the requested root changed since the caller selected it. */
    expectedPlugin?: {
        name: string;
        marketplaceName: string;
        version?: string;
        sha256?: string;
    };
    /** 是否强制重新安装 */
    force?: boolean;
    /** marketplace 已由上层刷新时，避免 updatePlugins 再次拉取。 */
    skipMarketplaceSync?: boolean;
    /** 是否自动启用 */
    autoEnable?: boolean;
    /**
     * @internal Materialize registry/cache without writing enabledPlugins.
     * Used by product declarations that preinstall optional plugins.
     */
    persistEnabledState?: boolean;
    /**
     * @internal Apply autoEnable only when the settings key is absent, so an
     * explicit user false remains authoritative.
     */
    preserveExistingEnabledState?: boolean;
    /** 安装 scope (user/project/project-local)，默认为 user */
    scope?: PluginInstallScope;
    /** 工作区路径覆盖，用于嵌入式 sidecar 的 project-local scope settings 写入。 */
    workspacePath?: string;
    /** Internal exact Marketplace selection; never accepted from the HTTP wire. */
    marketplace?: Marketplace;
    /**
     * @internal Effective settings projection for an explicit workspace.
     * Resource preparation supplies this so the standard installer does not
     * accidentally consult the long-lived process cwd while checking scopes.
     */
    enabledPluginStates?: Readonly<Record<string, {
        enabled: boolean;
        scope: PluginInstallScope;
    }>>;
}
/**
 * 插件卸载选项
 */
export interface PluginUninstallOptions {
    /** 是否删除配置文件 */
    removeConfig?: boolean;
    /** 保留 ~/.codebuddy/plugins/data/{id} 中的持久化插件数据。 */
    keepData?: boolean;
    /** 卸载 scope (user/project/project-local)；省略时沿用已解析插件的安装 scope。 */
    scope?: PluginInstallScope;
    /** 卸载后同时清理该 scope 下不再被依赖的自动安装插件。 */
    prune?: boolean;
    /** project/local scope 对应的工作区路径覆盖。 */
    workspacePath?: string;
    /** Internal exact Marketplace selection; never accepted from the HTTP wire. */
    marketplace?: Marketplace;
    /** 是否绕过管控策略检查（仅限内部管控操作使用） */
    bypassPolicyCheck?: boolean;
}
export interface PluginPruneOptions {
    /** 清理 scope，默认 user。 */
    scope?: PluginInstallScope;
    /** project/local scope 对应的工作区路径覆盖。 */
    workspacePath?: string;
    /** 仅返回将被清理的插件，不修改 settings 或 registry。 */
    dryRun?: boolean;
}
/**
 * 插件验证器接口
 * 负责验证插件和市场清单文件的有效性
 */
export declare const PluginValidator: unique symbol;
export interface PluginValidator {
    /** 验证插件或市场清单 */
    validateManifest(inputPath: string): Promise<any>;
}
/**
 * 插件管理器接口
 * 负责插件的安装、卸载、启用、禁用等核心功能
 * 同时负责管理插件市场
 */
export declare const PluginManager: unique symbol;
/**
 * One entry in the plugin set currently active in this CLI process.
 *
 * Management APIs may already expose newer install/enable state, but runtime
 * consumers keep reading this snapshot until startup or an explicit
 * `/reload-plugins` refreshes it. This mirrors Claude Code's pending-vs-active
 * plugin semantics with one process-local activation boundary.
 */
export interface ActivePluginRuntimeEntry {
    readonly plugin: PluginInfo;
    readonly components: PluginComponents;
}
/**
 * Effective enabled state selected by the settings precedence rules for one
 * explicit workspace. Management discovery supplies this snapshot so Plugin
 * runtime preparation never needs to consult or mutate the process-global cwd.
 */
export interface PluginWorkspaceEnabledState {
    readonly enabled: boolean;
    readonly scope: PluginInstallScope;
}
/**
 * One marketplace selected for an explicit workspace. `storageName` is the
 * settings/registry identity; the runtime marketplace manifest may expose a
 * different display name.
 */
export interface PluginWorkspaceMarketplaceEntry {
    readonly marketplace: Marketplace;
    readonly storageName: string;
}
export interface PluginWorkspaceMarketplaceDiagnostic {
    readonly marketplaceName?: string;
    readonly marketplacePath: string;
    readonly message: string;
}
/**
 * Side-effect-free marketplace projection for one explicit workspace.
 * Directory sources may be represented by inert transient Marketplace
 * instances. Remote sources are included only when an exactly matching global
 * materialization already exists; discovery never installs or rewrites them.
 */
export interface PluginWorkspaceMarketplaceCatalog {
    readonly workspacePath: string;
    readonly entries: readonly PluginWorkspaceMarketplaceEntry[];
    readonly errors: readonly PluginWorkspaceMarketplaceDiagnostic[];
}
export interface PluginRuntimeLoadError {
    readonly type: 'dependency-unsatisfied' | 'component-load-failed';
    readonly source: string;
    readonly message: string;
    readonly reason?: 'not-found' | 'not-enabled' | 'version-unsatisfied' | 'unknown';
    readonly dependency?: string;
    readonly dependencyMarketplace?: string;
}
export interface ActivePluginRefreshPreparation {
    readonly previousActivePlugins: readonly ActivePluginRuntimeEntry[];
    readonly activePlugins: readonly ActivePluginRuntimeEntry[];
    readonly errors: readonly PluginRuntimeLoadError[];
}
/**
 * Runtime eligibility result for an explicit workspace. It may emit normal
 * loader diagnostics, but unlike refreshActivePlugins() it does not publish a
 * process-wide active Plugin snapshot or update the MCP registry.
 */
export interface PluginWorkspaceRuntimePreparation {
    readonly activePlugins: readonly ActivePluginRuntimeEntry[];
    readonly errors: readonly PluginRuntimeLoadError[];
}
export interface ActivePluginRefreshOptions {
    /**
     * Runs after the fresh snapshot has been fully prepared but before it is
     * published. Throwing keeps the previous runtime snapshot active.
     */
    readonly beforeCommit?: (preparation: ActivePluginRefreshPreparation) => void | Promise<void>;
    /** Refresh only this required closure and preserve healthy unselected entries. */
    readonly pluginIds?: readonly string[];
}
export interface PluginDependencyRepairResult {
    readonly installed: readonly string[];
    readonly failed: readonly {
        pluginId: string;
        error: string;
    }[];
}
export interface PluginRepairOptions {
    /** Restrict repair to enabled roots owned by these settings scopes. */
    enabledPluginScopes?: readonly SettingsScope[];
    /** Persist repaired dependency enablement; false keeps it session-local. */
    persistEnabledPlugins?: boolean;
}
export interface PluginManager {
    /** 插件和市场配置变更事件 */
    readonly onDidChange: Event<void>;
    /** 添加市场 */
    addMarketplace(source: string, options?: MarketplaceAddOptions): Promise<Marketplace>;
    /** 更新市场 */
    updateMarketplace(name: string, options?: MarketplaceUpdateOptions): Promise<Marketplace>;
    /** 删除市场 */
    removeMarketplace(name: string, options?: MarketplaceSelectionOptions): Promise<void>;
    /** 列出所有市场 */
    listMarketplace(): Promise<Marketplace[]>;
    /** 获取市场信息 */
    getMarketplace(name: string): Promise<Marketplace | undefined>;
    /** Resolve only by the stable persisted storage identity. */
    getMarketplaceByStorageName(name: string): Promise<Marketplace | undefined>;
    /** Build an inert directory marketplace for one explicit workspace read. */
    createWorkspaceDirectoryMarketplace(marketplaceName: string, directory: string): Marketplace;
    /**
     * Resolve USER -> PROJECT -> LOCAL -> CLI marketplace settings for one
     * explicit workspace without consulting or mutating the process cwd.
     */
    resolveMarketplacesForWorkspace(workspacePath: string): Promise<PluginWorkspaceMarketplaceCatalog>;
    /** 设置市场自动更新状态 */
    setMarketplaceAutoUpdate(name: string, autoUpdate: boolean): Promise<void>;
    /** 从市场获取插件列表 */
    getPlugins(marketplaceName: string, options?: MarketplaceSelectionOptions): Promise<PluginInfo[]>;
    /** 安装插件 */
    installPlugins(pluginNames: string[], marketplaceName: string, options?: PluginInstallOptions): Promise<void>;
    /** 更新插件 */
    updatePlugins(pluginNames: string[], marketplaceName: string, options?: PluginInstallOptions): Promise<void>;
    /** 卸载插件 */
    uninstallPlugins(pluginNames: string[], marketplaceName: string, options?: PluginUninstallOptions): Promise<void>;
    /** 清理指定 scope 中不再被任何手动安装插件依赖的 auto dependency。 */
    prunePlugins(options?: PluginPruneOptions): Promise<string[]>;
    /** 补装 enabledPlugins 中缺失的根插件和依赖，并修复版本不满足的依赖。 */
    repairEnabledPlugins(options?: PluginRepairOptions): Promise<void>;
    /**
     * Claude-compatible reload repair: only install manifest dependencies that
     * are missing for an enabled plugin. It does not repair missing roots or
     * version mismatches and never updates marketplaces.
     */
    repairMissingPluginDependencies(): Promise<PluginDependencyRepairResult>;
    /**
     * 启用插件
     *
     * @param options.bypassPolicyCheck 跳过企业管控策略检查（autoEnable 场景）
     * @param options.persist 是否把 enabled 状态写入 settings.json（默认 true）。
     *   设置为 `false` 时只改进程内的 `plugin.status`，不落盘，不触发持久化污染。
     */
    enablePlugins(pluginNames: string[], marketplaceName: string, options?: {
        bypassPolicyCheck?: boolean;
        persist?: boolean;
        scope?: PluginInstallScope;
        workspacePath?: string;
    }): Promise<void>;
    /**
     * 禁用插件
     *
     * @param options.persist 是否把 disabled 状态写入 settings.json（默认 true）。
     *   设置为 `false` 时只改进程内的 `plugin.status`，不落盘。
     *   通常与 `enablePlugins({ persist: false })` 成对使用。
     */
    disablePlugins(pluginNames: string[], marketplaceName: string, options?: {
        persist?: boolean;
        scope?: PluginInstallScope;
        workspacePath?: string;
    }): Promise<void>;
    /**
     * 原子切换插件：在同一事务中 disable 旧插件 + enable 新插件，只触发一次管理态变更事件。
     * 是否立即激活由调用方随后进入显式 refresh 边界决定。
     *
     * @param disableNames 需要禁用的插件名列表（可为空数组）
     * @param enableNames 需要启用的插件名列表（可为空数组）
     * @param marketplaceName 市场名称（disable 和 enable 共享）
     * @param options.persist 是否落盘（默认 true）
     */
    switchPlugins(disableNames: string[], enableNames: string[], marketplaceName: string, options?: {
        persist?: boolean;
    }): Promise<void>;
    /** Validate/expand a detached USER selection before a caller commits it.
     * Reads only committed caches. Never writes settings or activates plugins.
     */
    prepareUserPluginSelection(current: Readonly<Record<string, boolean>>, next: Readonly<Record<string, boolean>>, editedPluginIds?: ReadonlySet<string>): Promise<Record<string, boolean>>;
    /** Read installed records without catalog access, materialization or runtime activation.
     * Omitted workspacePath restricts the result to USER/managed installations.
     */
    inspectInstalledPlugins(options: {
        enabledPlugins: Readonly<Record<string, PluginWorkspaceEnabledState>>;
        workspacePath?: string;
    }): Promise<PluginInfo[]>;
    /** 获取已安装插件列表 */
    getInstalledPlugins(): Promise<PluginInfo[]>;
    /**
     * Read the committed installed-registry projection for the current
     * request's settings without publishing it to the shared runtime cache.
     * Optional explicit roots limit manifest reads to their dependency closure
     * when settings precedence is unambiguous; otherwise retains full resolution.
     */
    inspectCommittedPluginsForCurrentSettings(requestedPluginIds?: readonly string[]): Promise<PluginInfo[]>;
    /** 获取插件信息 */
    getPlugin(pluginName: string, marketplaceName: string, options?: MarketplaceSelectionOptions): Promise<PluginInfo | undefined>;
    /**
     * Resolve the materialized Plugin selected by an explicit workspace
     * settings scope without consulting the process-global cwd cache.
     * Management discovery uses this for multi-cwd inventory reads.
     */
    getPluginForWorkspace(pluginName: string, marketplaceName: string, options: {
        /**
         * Explicit workspace catalog entry; avoids process-global lookup.
         * `null` is an authoritative workspace miss and forbids fallback.
         */
        marketplace?: Marketplace | null;
        scope: PluginInstallScope;
        workspacePath: string;
    }): Promise<PluginInfo | undefined>;
    /**
     * Apply the same dependency, version, integrity and component-load guards
     * as runtime activation to the effective Plugin settings for an explicit
     * workspace, without changing the process active snapshot.
     */
    prepareActivePluginsForWorkspace(options: {
        workspacePath: string;
        enabledPlugins: Readonly<Record<string, PluginWorkspaceEnabledState>>;
    }): Promise<PluginWorkspaceRuntimePreparation>;
    /**
     * Resolve only the Plugin MCP component set for an explicit workspace.
     * The result is inert: it neither replaces the process active snapshot nor
     * publishes/opens an MCP connection in this process. Missing enabled roots
     * and dependencies may be materialized into the shared immutable cache,
     * but the explicit selection is never written to settings or session state.
     */
    preparePluginMcpForWorkspace(options: {
        workspacePath: string;
        enabledPlugins: Readonly<Record<string, PluginWorkspaceEnabledState>>;
    }): Promise<PluginWorkspaceRuntimePreparation>;
    /** 获取插件扩展组件列表 */
    getPluginComponents(pluginName: string, marketplaceName: string): Promise<PluginComponents | undefined>;
    /** 获取当前进程已经激活的插件快照；不会隐式读取或激活管理态。 */
    getActivePlugins(): Promise<readonly ActivePluginRuntimeEntry[]>;
    /**
     * 从最新 settings/install 状态整体重建 active plugin 快照。
     * 仅启动屏障和显式 reload 调用；普通管理操作只留下 pending 状态。
     */
    refreshActivePlugins(options?: ActivePluginRefreshOptions): Promise<readonly ActivePluginRuntimeEntry[]>;
    /** 从 settings 中安装配置的市场 */
    installMarketplacesFromSettings(options?: {
        marketplaceNames?: readonly string[];
        skipInstalledPluginRefresh?: boolean;
        throwOnFailure?: boolean;
        workspacePath?: string;
    }): Promise<void>;
    /**
     * Reconcile the effective Product and CLI-settings plugin declarations.
     *
     * This is the strict, host-neutral readiness boundary used before a host
     * consumes plugins. It only materializes configured marketplaces,
     * product-declared plugins, enabled roots, and their dependencies. Legacy
     * migrations, cache cleanup, and marketplace auto-update remain background
     * maintenance and are deliberately excluded.
     */
    reconcileConfiguredPlugins(): Promise<void>;
    /** 清除插件缓存（用于热更新） */
    clearCache(): void;
    /** 获取所有启用插件的 bin/ 目录路径（用于注入 Bash PATH） */
    getPluginBinPaths(): Promise<string[]>;
    /** 获取插件用户配置选项值 */
    getPluginOptions(pluginName: string, marketplaceName: string): Promise<Record<string, string | boolean | number>>;
    /** 保存插件用户配置选项值 */
    savePluginOptions(pluginName: string, marketplaceName: string, values: Record<string, string | boolean | number>): Promise<void>;
    /** 按当前运行时 settings 惰性发布现有 immutable cache 投影。 */
    whenReady(): Promise<void>;
    /**
     * 首个 runtime 投影发布后，后台 reconcile marketplace 和 Plugin desired
     * state。使用 --no-plugin-management 时这是只等待 cache readiness 的 no-op。
     */
    startBackgroundPluginManagement(): Promise<void>;
    /**
     * Enabled plugins from a local directory marketplace whose early, pre-download
     * install failed in this process. Waiting for them cannot help, so the
     * first-turn compose gate stops waiting as soon as they appear here.
     */
    getLocalInstallFailures?(): ReadonlySet<string>;
    /** A host may own background writes while keeping explicit session operations available. */
    isBackgroundManagementEnabled?(): boolean;
}
/**
 * 插件安装器接口
 */
export declare const PluginInstaller: unique symbol;
export interface PluginInstaller {
    /**
     * 判断该安装器是否支持指定的插件源
     * @param pluginSource 插件源配置(字符串或对象)
     * @returns true表示支持,false表示不支持
     */
    support(pluginSource: string | PluginSource): boolean;
    /**
     * 安装插件到指定目录
     * @param pluginEntry 市场插件条目
     * @param targetDir 目标安装目录
     * @param onProgress 进度回调
     * @returns 插件的实际安装路径
     */
    install(pluginEntry: MarketplacePluginEntry, targetDir: string, onProgress?: (message: string) => void): Promise<string>;
    /**
     * 更新已安装的插件
     * @param pluginEntry 市场插件条目
     * @param installedPath 已安装的路径
     * @param onProgress 进度回调
     * @returns 更新后的插件路径
     */
    update(pluginEntry: MarketplacePluginEntry, installedPath: string, onProgress?: (message: string) => void): Promise<string>;
    /**
     * 检查插件是否已安装
     * @param pluginInfo 插件信息
     * @param marketplaceInstalledPath 目标目录
     * @returns 已安装则返回路径,否则返回undefined
     */
    isInstalled(pluginInfo: MarketplacePluginEntry, marketplaceInstalledPath: string): Promise<string | undefined>;
}
/**
 * 插件安装结果
 */
export interface PluginInstallResult {
    /** 插件名称 */
    pluginName: string;
    /** 安装路径 */
    installedPath: string;
    /** 是否为新安装 */
    isNewInstall: boolean;
}
/**
 * 扩展加载器接口
 */
export declare const ExtensionLoader: unique symbol;
export interface ExtensionLoader {
    /**
     * 加载扩展,返回加载的数据
     * @param extensionDir 扩展目录路径
     * @param extensionName 扩展名称(用于标记)
     * @returns 加载的扩展数据数组
     */
    load(extensionDir: string, extensionName?: string): Promise<ProductConfiguration>;
}
/**
 * 市场存储接口
 */
export declare const MarketplaceStorage: unique symbol;
export interface MarketplaceStorage {
    /** 获取所有市场配置 */
    getMarketplaces(options?: {
        /** Recovery-only raw view; normal readers hide an actively published alias. */
        includePublishing?: boolean;
    }): Promise<MarketplaceInfo[]>;
    /** 保存市场配置 */
    saveMarketplace(marketplace: MarketplaceInfo): Promise<void>;
    /** 删除市场配置 */
    removeMarketplace(name: string): Promise<void>;
    /** 检查市场是否已安装 */
    isMarketplaceInstalled(name: string): Promise<boolean>;
}
/**
 * 插件扩展组件集合
 */
export interface PluginComponents {
    marketplaceName: string;
    pluginName: string;
    /** Agent 列表 */
    agents?: any[];
    /** Command 列表 */
    commands?: any[];
    /** Skill 列表 */
    skills?: any[];
    /** Hook 配置，键为事件名，值为 HookConfig 数组 */
    hooks?: Record<string, any[]>;
    /** MCP 服务器列表 */
    mcpServers?: Record<string, McpConfig>;
    /** LSP 服务器列表 */
    lspServers?: Record<string, LspServerConfig>;
    /** Output style 列表 */
    outputStyles?: PluginOutputStyleEntry[];
    /** 插件默认设置 */
    settings?: PluginSettings;
}
export declare const MarketplaceConfigManager: unique symbol;
export interface MarketplaceConfigManager {
    /**
     * 获取所有配置的市场(合并用户和项目配置)
     */
    getConfiguredMarketplaces(options?: {
        /** 是否包含当前 served request 的 session-tier 声明，默认 true。 */
        includeSession?: boolean;
        /**
         * Resolve PROJECT and LOCAL declarations for this workspace instead
         * of consulting the long-lived process cwd.
         */
        workspacePath?: string;
    }): Promise<Map<string, MarketplaceSource>>;
    /**
     * 获取需要安装的市场列表
     */
    getMarketplacesToInstall(options?: {
        workspacePath?: string;
    }): Promise<MarketplaceToInstall[]>;
}
/**
 * 待安装的市场配置
 */
export interface MarketplaceToInstall {
    /** 市场名称 */
    name: string;
    /** 市场源配置 */
    source: MarketplaceSource;
    /** 声明式自动更新策略；未声明时保留现有值 */
    autoUpdate?: boolean;
}
/**
 * 内置市场提供者接口
 * 负责从 ProductManager 读取 builtInMarketplaces 配置
 */
export declare const BuiltInMarketplaceProvider: unique symbol;
export interface BuiltInMarketplaceProvider {
    /**
     * 获取所有内置市场配置
     * 将对象结构转换为带名称的数组结构
     */
    getBuiltInMarketplaces(): Promise<MarketplaceConfigEntry[]>;
    /**
     * 检查指定市场是否为内置市场
     * @param name 市场名称
     */
    isBuiltInMarketplace(name: string): Promise<boolean>;
    /**
     * Return the current Product-declared version URL for a built-in
     * marketplace. The URL is intentionally not persisted in marketplace
     * storage so Product metadata remains the single source of truth.
     */
    getVersionUrl(name: string): Promise<string | undefined>;
    /**
     * 将市场配置转换为 MarketplaceSource
     * @param config 市场配置项（带名称）
     */
    toMarketplaceSource(config: MarketplaceConfigEntry): MarketplaceSource;
}
/**
 * 更新检查结果
 */
export interface MarketplaceNeedsUpdateResult {
    /** 是否需要更新 */
    needsUpdate: boolean;
    /**
     * 检查来源，便于日志与排错
     */
    reason: 'throttled' | 'version-url-match' | 'version-url-changed' | 'url-version-match' | 'url-version-changed' | 'etag-match' | 'etag-changed' | 'last-modified-match' | 'last-modified-changed' | 'no-metadata' | 'head-failed' | 'first-install';
    /** 通过 versionUrl 或 url-version 得到的版本号，供 commitVersion 使用 */
    remoteVersion?: string;
    /** 通过 HEAD 读到的 ETag（HTTP 路径） */
    etag?: string;
    /** 通过 HEAD 读到的 Last-Modified（HTTP 路径） */
    lastModified?: string;
}
/**
 * 市场更新检查器
 *
 * 按 versionUrl → url-version → ETag → Last-Modified 的顺序判断远端是否有新版本。
 * 内置 mtime 节流，避免短时间内多次触发同一市场的远端检查。
 */
export declare const MarketplaceUpdateChecker: unique symbol;
export interface MarketplaceUpdateChecker {
    /**
     * 判断市场是否需要更新
     * @param args.marketplaceName 市场名称（用于节流键与日志）
     * @param args.installLocation 本地已安装路径
     * @param args.zipUrl ZIP 源 URL（用于 HEAD 检查）
     * @param args.versionUrl Product 元数据声明的纯文本版本 URL（仅内置市场）。
     * @param args.urlVersion 调用方从 zipUrl 解析出的 UUID 版本号（仅内置市场传入）。
     *   传入则走本地版本号比对，不命中再回落到 ETag/Last-Modified。
     *   非内置市场不传，直接走 ETag 兜底，行为与历史一致。
     */
    needsUpdate(args: {
        marketplaceName: string;
        installLocation: string;
        zipUrl: string;
        versionUrl?: string;
        urlVersion?: string;
    }): Promise<MarketplaceNeedsUpdateResult>;
    /**
     * 更新成功后写入远端版本号到本地缓存文件（与 `.zip-metadata.json` 同目录）
     */
    commitVersion(marketplaceName: string, installLocation: string, version: string): Promise<void>;
    /**
     * 清除指定市场的本地版本缓存（`.marketplace-version` 与 `.zip-metadata.json`）。
     *
     * 用于用户显式要求的"强制更新"路径；checker 内部基于
     * mtime throttle / url-version / ETag 的 short-circuit 可能仍会判为"无需更新"。
     * 在调用 `Marketplace.update` 之前先 invalidate 一次，让 checker 重新走
     * `no-metadata` / `url-version-changed` 分支，确保下载与整目录覆盖真正发生。
     *
     * 实现必须 best-effort，不存在或删除失败都不应抛出。
     */
    invalidateCache(marketplaceName: string, installLocation: string): Promise<void>;
}
/**
 * 插件默认设置（allowlist 机制）
 */
export interface PluginSettings {
    /** 设置默认 agent（插件 agents/ 中定义的 agent 名称） */
    agent?: string;
    /** Claude 兼容字段；当前仅保留在组件元数据中，尚未接入子 agent 状态行运行时。 */
    subagentStatusLine?: unknown;
}
/**
 * MCP Bundle 条目定义
 * 用于从远程 URL 或本地文件加载预打包的 MCP 服务
 */
export interface McpBundleEntry {
    /** 服务器名称 */
    name: string;
    /** 下载 URL 或本地文件路径（.mcpb/.dxt/.zip） */
    source: string;
    /** 内容校验和（格式 sha256:hex） */
    checksum?: string;
    /** MCP Bundle 版本 */
    version?: string;
}
/**
 * MCP Bundle 加载结果
 */
export interface McpBundleLoadResult {
    /** Bundle 名称 */
    name: string;
    /** 生成的 MCP 服务器配置 */
    mcpConfig: McpConfig;
    /** 解压路径 */
    extractedPath: string;
    /** 内容哈希 */
    contentHash: string;
}
/**
 * MCP Bundle 缓存元数据
 */
export interface McpBundleCacheMetadata {
    /** 源地址 */
    source: string;
    /** 内容哈希 */
    contentHash: string;
    /** 解压路径 */
    extractedPath: string;
    /** 缓存时间 */
    cachedAt: string;
    /** 最后检查时间 */
    lastChecked: string;
}
/**
 * 插件用户配置字段定义
 */
export interface PluginUserConfigField {
    /** 字段类型 */
    type: 'string' | 'boolean' | 'number';
    /** 字段描述 */
    description: string;
    /** 默认值 */
    default?: string | boolean | number;
    /** 是否为敏感字段（如 API Key，存储到安全存储） */
    sensitive?: boolean;
    /** 是否必填 */
    required?: boolean;
}
/**
 * 插件 output style 条目
 */
export interface PluginOutputStyleEntry {
    /** 样式名称（命名空间化：plugin-name:style-name） */
    name: string;
    /** 样式描述 */
    description: string;
    /** 样式内容（Markdown） */
    content: string;
    /** 是否保留编码指令 */
    keepCodingInstructions?: boolean;
    /** 插件启用时是否强制应用该样式 */
    forceForPlugin?: boolean;
}
/**
 * 插件 background monitor 条目
 */
export interface PluginMonitorEntry {
    /** Monitor 名称，插件内唯一 */
    name: string;
    /** 持续运行的 shell command */
    command: string;
    /** 展示描述 */
    description: string;
    /** 触发时机，默认 always */
    when?: string;
}
export interface InstalledPluginRecord {
    /** SHA256 verified by the remote archive installer. */
    archiveSha256?: string;
    /** 安装 scope */
    scope: 'managed' | 'user' | 'project' | 'local';
    /** project/local scope 对应的项目路径。 */
    projectPath?: string;
    /** 已物化 cache 路径 */
    installPath: string;
    /** Verified materialized source fingerprint. Legacy records without it remain readable but unsealed. */
    contentHash?: string;
    /** 当前 cache version key，可能是显式版本、Git SHA 或 tag 版本加 SHA 后缀。 */
    version?: string;
    /** tag 约束解析出的版本。 */
    resolvedVersion?: string;
    /** Git 来源实际安装的 commit SHA。 */
    gitCommitSha?: string;
    /** 是否由依赖自动安装；缺失表示手动安装。 */
    auto?: boolean;
    /**
     * 物化时 marketplace entry 已声明的依赖。源插件的 plugin.json 保持 vendor
     * 原样，因此该元数据用于保留两层 manifest 合并后的运行语义。
     */
    dependencies?: PluginDependency[];
    /** 首次安装时间 */
    installedAt?: string;
    /** 最近更新时间 */
    lastUpdated?: string;
}
export interface InstalledPluginsRegistry {
    version: 2;
    plugins: Record<string, InstalledPluginRecord[]>;
}
export declare const PLUGINS_METADATA_DIRS: string[];
export declare const MARKETPLACE_STORAGE_FILE_NAME = "known_marketplaces.json";
export declare const INSTALLED_PLUGINS_FILE_NAME = "installed_plugins.json";
export declare const MARKETPLACE_MANIFEST_FILE = "marketplace.json";
export declare const PLUGIN_MANIFEST_FILE = "plugin.json";
/** Marketplace source checkout root, matching Claude's `plugins/marketplaces/<marketplace>` layout. */
export declare const MARKETPLACES_DIR = "marketplaces";
/** Installed plugin cache root, matching Claude's `plugins/cache/<marketplace>/<plugin>/<version>` layout. */
export declare const PLUGIN_CACHE_DIR = "cache";
/** @deprecated Use MARKETPLACES_DIR for marketplace sources or PLUGIN_CACHE_DIR for installed plugin cache. */
export declare const MARKETPLACE_CACHE_DIR = "marketplaces";
export declare const DEFAULT_GIT_PLUGINS_DIR = "plugins";
/** Install stats cache file name */
export declare const INSTALL_STATS_CACHE_FILE_NAME = "install-counts-cache.json";
/**
 * 市场未就绪错误
 * 当 builtInMarketPluginsMerge 策略引用的市场尚未安装完成时抛出
 * 此错误类型用于标识可重试的错误（pending 队列机制）
 */
export declare class MarketplaceNotReadyError extends Error {
    constructor(marketplaceName: string);
}
/** Remote URL for plugin install statistics */
export declare const INSTALL_STATS_REMOTE_URL = "https://raw.githubusercontent.com/anthropics/claude-plugins-official/refs/heads/stats/stats/plugin-installs.json";
/** Install stats cache TTL: 1 hour in milliseconds */
export declare const INSTALL_STATS_CACHE_TTL_MS: number;
/** Concurrent marketplace installation limit */
export declare const CONCURRENT_MARKETPLACE_INSTALL_LIMIT = 3;
/** Concurrent plugin installation limit */
export declare const CONCURRENT_PLUGIN_INSTALL_LIMIT = 5;
/** Concurrent marketplace update limit */
export declare const CONCURRENT_MARKETPLACE_UPDATE_LIMIT = 2;
/** Concurrent marketplace plugin listing limit */
export declare const CONCURRENT_MARKETPLACE_PLUGIN_LOAD_LIMIT = 4;
/** Concurrent plugin metadata loading limit */
export declare const CONCURRENT_PLUGIN_METADATA_LOAD_LIMIT = 16;
/** Concurrent plugin component loading limit */
export declare const CONCURRENT_PLUGIN_COMPONENT_LOAD_LIMIT = 16;
/**
 * Plugin installation scope
 * Uses existing SettingsScope for consistency
 * Note: Currently uses all SettingsScope values to simplify type compatibility.
 * While plugins typically only use USER/PROJECT/PROJECT_LOCAL, including CLI scope
 * avoids type casting issues without practical drawbacks.
 */
export type PluginInstallScope = SettingsScope;
/**
 * Plugin install statistics
 */
export interface PluginInstallStats {
    /** Plugin name (key from remote JSON) */
    name: string;
    /** Number of installations */
    installs: number;
}
/**
 * Plugin error type enum
 */
export declare enum PluginErrorType {
    PathNotFound = "path-not-found",
    GitAuthFailed = "git-auth-failed",
    GitTimeout = "git-timeout",
    NetworkError = "network-error",
    ManifestParseError = "manifest-parse-error",
    ManifestValidationError = "manifest-validation-error",
    PluginNotFound = "plugin-not-found",
    MarketplaceNotFound = "marketplace-not-found",
    MarketplaceLoadFailed = "marketplace-load-failed",
    RepositoryScanFailed = "repository-scan-failed",
    McpConfigInvalid = "mcp-config-invalid",
    HookLoadFailed = "hook-load-failed",
    ComponentLoadFailed = "component-load-failed",
    McpbDownloadFailed = "mcpb-download-failed",
    McpbExtractFailed = "mcpb-extract-failed",
    McpbInvalidManifest = "mcpb-invalid-manifest",
    MarketplaceBlockedByPolicy = "marketplace-blocked-by-policy",
    MarketplaceRemoveFailed = "marketplace-remove-failed",
    MarketplaceUpdateFailed = "marketplace-update-failed",
    MarketplaceInstallFailed = "marketplace-install-failed",
    InstallFailed = "install-failed",
    UpdateFailed = "update-failed",
    UninstallFailed = "uninstall-failed",
    EnableFailed = "enable-failed",
    DisableFailed = "disable-failed",
    LoadFailed = "load-failed",
    MarketplaceConfigSaveFailed = "marketplace-config-save-failed",
    DependencyUnsatisfied = "dependency-unsatisfied",
    DependencyVersionUnsatisfied = "dependency-version-unsatisfied",
    DependencyNoMatchingTag = "no-matching-tag",
    DependencyRangeConflict = "range-conflict",
    DependencyCrossMarketplaceBlocked = "cross-marketplace",
    GenericError = "generic-error"
}
/**
 * Detailed plugin error types with specific fields
 */
export type PluginError = PluginErrorPathNotFound | PluginErrorGitAuthFailed | PluginErrorGitTimeout | PluginErrorNetworkError | PluginErrorManifestParseError | PluginErrorManifestValidationError | PluginErrorPluginNotFound | PluginErrorMarketplaceNotFound | PluginErrorMarketplaceLoadFailed | PluginErrorRepositoryScanFailed | PluginErrorMcpConfigInvalid | PluginErrorHookLoadFailed | PluginErrorComponentLoadFailed | PluginErrorMcpbDownloadFailed | PluginErrorMcpbExtractFailed | PluginErrorMcpbInvalidManifest | PluginErrorMarketplaceBlockedByPolicy | PluginErrorMarketplaceRemoveFailed | PluginErrorMarketplaceUpdateFailed | PluginErrorMarketplaceInstallFailed | PluginErrorInstallFailed | PluginErrorUpdateFailed | PluginErrorUninstallFailed | PluginErrorEnableFailed | PluginErrorDisableFailed | PluginErrorLoadFailed | PluginErrorMarketplaceConfigSaveFailed | PluginErrorDependencyUnsatisfied | PluginErrorDependencyVersionUnsatisfied | PluginErrorDependencyNoMatchingTag | PluginErrorDependencyRangeConflict | PluginErrorDependencyCrossMarketplaceBlocked | PluginErrorGenericError;
/** Base error properties */
interface PluginErrorBase {
    /** Error unique ID */
    id: string;
    /** Timestamp when error occurred */
    timestamp: Date;
    /** Plugin name (if applicable) */
    plugin?: string;
    /** Marketplace name (if applicable) */
    source?: string;
}
export interface PluginErrorPathNotFound extends PluginErrorBase {
    type: PluginErrorType.PathNotFound;
    component: string;
    path: string;
}
export interface PluginErrorGitAuthFailed extends PluginErrorBase {
    type: PluginErrorType.GitAuthFailed;
    gitUrl: string;
    authType: 'ssh' | 'https';
}
export interface PluginErrorGitTimeout extends PluginErrorBase {
    type: PluginErrorType.GitTimeout;
    gitUrl: string;
    operation: string;
}
export interface PluginErrorNetworkError extends PluginErrorBase {
    type: PluginErrorType.NetworkError;
    url: string;
    details?: string;
}
export interface PluginErrorManifestParseError extends PluginErrorBase {
    type: PluginErrorType.ManifestParseError;
    manifestPath: string;
    parseError: string;
}
export interface PluginErrorManifestValidationError extends PluginErrorBase {
    type: PluginErrorType.ManifestValidationError;
    manifestPath: string;
    validationErrors: string[];
}
export interface PluginErrorPluginNotFound extends PluginErrorBase {
    type: PluginErrorType.PluginNotFound;
    pluginId: string;
    marketplace: string;
}
export interface PluginErrorMarketplaceNotFound extends PluginErrorBase {
    type: PluginErrorType.MarketplaceNotFound;
    marketplace: string;
    availableMarketplaces: string[];
}
export interface PluginErrorMarketplaceLoadFailed extends PluginErrorBase {
    type: PluginErrorType.MarketplaceLoadFailed;
    marketplace: string;
    reason: string;
}
export interface PluginErrorRepositoryScanFailed extends PluginErrorBase {
    type: PluginErrorType.RepositoryScanFailed;
    repositoryPath: string;
    reason: string;
}
export interface PluginErrorMcpConfigInvalid extends PluginErrorBase {
    type: PluginErrorType.McpConfigInvalid;
    serverName: string;
    validationError: string;
}
export interface PluginErrorHookLoadFailed extends PluginErrorBase {
    type: PluginErrorType.HookLoadFailed;
    hookPath: string;
    reason: string;
}
export interface PluginErrorComponentLoadFailed extends PluginErrorBase {
    type: PluginErrorType.ComponentLoadFailed;
    component: string;
    path: string;
    reason: string;
}
export interface PluginErrorMcpbDownloadFailed extends PluginErrorBase {
    type: PluginErrorType.McpbDownloadFailed;
    url: string;
    reason: string;
}
export interface PluginErrorMcpbExtractFailed extends PluginErrorBase {
    type: PluginErrorType.McpbExtractFailed;
    mcpbPath: string;
    reason: string;
}
export interface PluginErrorMcpbInvalidManifest extends PluginErrorBase {
    type: PluginErrorType.McpbInvalidManifest;
    mcpbPath: string;
    validationError: string;
}
export interface PluginErrorMarketplaceBlockedByPolicy extends PluginErrorBase {
    type: PluginErrorType.MarketplaceBlockedByPolicy;
    marketplace: string;
    blockedByBlocklist: boolean;
    allowedSources: string[];
}
export interface PluginErrorMarketplaceRemoveFailed extends PluginErrorBase {
    type: PluginErrorType.MarketplaceRemoveFailed;
    marketplaceName: string;
    message: string;
    details: string;
}
export interface PluginErrorMarketplaceUpdateFailed extends PluginErrorBase {
    type: PluginErrorType.MarketplaceUpdateFailed;
    marketplaceName: string;
    message: string;
    details: string;
}
export interface PluginErrorMarketplaceInstallFailed extends PluginErrorBase {
    type: PluginErrorType.MarketplaceInstallFailed;
    marketplaceName: string;
    sourceUrl?: string;
    sourcePath?: string;
    message: string;
    details: string;
}
export interface PluginErrorInstallFailed extends PluginErrorBase {
    type: PluginErrorType.InstallFailed;
    pluginName: string;
    marketplaceName: string;
    message: string;
    details: string;
}
export interface PluginErrorUpdateFailed extends PluginErrorBase {
    type: PluginErrorType.UpdateFailed;
    pluginName: string;
    marketplaceName: string;
    message: string;
    details: string;
}
export interface PluginErrorUninstallFailed extends PluginErrorBase {
    type: PluginErrorType.UninstallFailed;
    pluginName: string;
    marketplaceName: string;
    message: string;
    details: string;
}
export interface PluginErrorEnableFailed extends PluginErrorBase {
    type: PluginErrorType.EnableFailed;
    pluginName: string;
    marketplaceName: string;
    message: string;
    details: string;
}
export interface PluginErrorDisableFailed extends PluginErrorBase {
    type: PluginErrorType.DisableFailed;
    pluginName: string;
    marketplaceName: string;
    message: string;
    details: string;
}
export interface PluginErrorLoadFailed extends PluginErrorBase {
    type: PluginErrorType.LoadFailed;
    componentType: 'MCP' | 'Hook' | 'Command' | 'Skill' | 'Agent' | 'PluginComponents';
    pluginName?: string;
    marketplaceName?: string;
    path?: string;
    message: string;
    details: string;
}
export interface PluginErrorMarketplaceConfigSaveFailed extends PluginErrorBase {
    type: PluginErrorType.MarketplaceConfigSaveFailed;
    operation: 'save' | 'remove' | 'clear' | 'repair';
    marketplaceName?: string;
    message: string;
    details: string;
}
export interface PluginErrorDependencyUnsatisfied extends PluginErrorBase {
    type: PluginErrorType.DependencyUnsatisfied;
    pluginName: string;
    marketplaceName: string;
    dependencyName: string;
    dependencyMarketplaceName: string;
    message: string;
    details: string;
}
export interface PluginErrorDependencyVersionUnsatisfied extends PluginErrorBase {
    type: PluginErrorType.DependencyVersionUnsatisfied;
    pluginName: string;
    marketplaceName: string;
    dependencyName: string;
    dependencyMarketplaceName: string;
    required: string;
    installed?: string;
    message: string;
    details: string;
}
export interface PluginErrorDependencyNoMatchingTag extends PluginErrorBase {
    type: PluginErrorType.DependencyNoMatchingTag;
    pluginName: string;
    marketplaceName: string;
    dependencyName: string;
    dependencyMarketplaceName: string;
    required: string;
    message: string;
    details: string;
}
export interface PluginErrorDependencyRangeConflict extends PluginErrorBase {
    type: PluginErrorType.DependencyRangeConflict;
    pluginName: string;
    marketplaceName: string;
    dependencyName: string;
    dependencyMarketplaceName: string;
    ranges: string[];
    message: string;
    details: string;
}
export interface PluginErrorDependencyCrossMarketplaceBlocked extends PluginErrorBase {
    type: PluginErrorType.DependencyCrossMarketplaceBlocked;
    pluginName: string;
    marketplaceName: string;
    dependencyName: string;
    dependencyMarketplaceName: string;
    message: string;
    details: string;
}
export interface PluginErrorGenericError extends PluginErrorBase {
    type: PluginErrorType.GenericError;
    error: string;
}
/**
 * Plugin error collector service interface
 */
export declare const PluginErrorCollector: unique symbol;
export interface PluginErrorCollector {
    /** Event fired when errors change */
    readonly onDidChange: Event<void>;
    /**
     * Add a new error
     * @param error Error to add (id and timestamp will be auto-generated if not provided)
     */
    addError(error: any): void;
    /**
     * Get all errors
     * @returns Array of plugin errors, sorted by timestamp descending
     */
    getErrors(): PluginError[];
    /**
     * Get errors filtered by type
     * @param type Error type to filter
     */
    getErrorsByType(type: PluginError['type']): PluginError[];
    /**
     * Get errors filtered by plugin
     * @param pluginName Plugin name
     * @param marketplaceName Marketplace name
     */
    getErrorsByPlugin(pluginName: string, marketplaceName: string): PluginError[];
    /**
     * Get error count
     */
    getErrorCount(): number;
    /**
     * Clear all errors
     */
    clearErrors(): void;
    /**
     * Clear errors for a specific plugin
     * @param pluginName Plugin name
     * @param marketplaceName Marketplace name
     */
    clearPluginErrors(pluginName: string, marketplaceName: string): void;
}
/**
 * Plugin install stats service interface
 */
export declare const PluginInstallStatsService: unique symbol;
export interface PluginInstallStatsService {
    /**
     * Fetch install statistics from remote
     * @returns Map of plugin name to install count
     */
    fetchInstallStats(): Promise<Map<string, number>>;
    /**
     * Get install count for a specific plugin
     * @param pluginName Plugin name
     * @returns Install count or undefined if not found
     */
    getInstallCount(pluginName: string): Promise<number | undefined>;
}
/**
 * Plugin load guard — optional pre-load integrity check.
 *
 * Implementations can block a plugin from loading (e.g. directory tampered).
 * Injected via @Optional() so the system works without any guard registered.
 */
export declare const PluginLoadGuard: unique symbol;
export interface PluginLoadGuard {
    /**
     * Called before loading plugin components.
     * Return false to block loading; throw to block with a specific error message.
     */
    canLoad(plugin: PluginInfo): Promise<boolean>;
}
export {};
//# sourceMappingURL=plugin-protocol.d.ts.map