import path from 'path';
import { McpScope } from '../mcp/mcp-protocol';
import { MemoryScope } from '../memory/memory-protocol';
import { SettingsScope } from '../settings/settings-protocol';
interface DirectoryPaths {
    data: string;
    config: string;
    cache: string;
    log: string;
    temp: string;
}
export declare abstract class PathUtils {
    static getSettingsFilePath(scope: SettingsScope): string;
    static getMemoryFilePath(scope: MemoryScope): string;
    static getMcpFilePath(scope: McpScope): string;
    /**
     * Base directory for the flat, top-level `~/.codebuddy.json` MCP config file.
     * Unlike settings/memory (which live inside `~/.codebuddy/`), this file is
     * intentionally at the home directory root — so we can't reuse `getHomeDir()`
     * directly (it defaults to `homedir()/.codebuddy`). Still honors
     * `CODEBUDDY_CONFIG_DIR` so tests can isolate this path like every other
     * CodeBuddy config file.
     */
    private static getMcpHomeBaseDir;
    /**
     * MCP config candidates in priority order.
     *
     * Keeping this list separate from resolution lets missing-file callers
     * distinguish "all candidates are absent" without duplicating priorities.
     */
    static getMcpCandidatePaths(scope: McpScope): string[];
    /**
     * Resolve the actual MCP config file path with priority-based fallback.
     * For USER scope: ~/.codebuddy/.mcp.json > ~/.codebuddy/mcp.json > ~/.codebuddy.json
     * For PROJECT scope: [project]/.mcp.json > [project]/mcp.json
     * Returns the first existing file, or the highest priority path if none exist.
     */
    static resolveMcpFilePath(scope: McpScope): string;
    static getMcpFilePathForDisplay(scope: McpScope): string;
    static getHomeProjectDir(): string;
    static getTracesDir(pid?: number): string;
    static getHomeProjectsDir(): string;
    static getHomeFileHistoryDir(sessionId: string): string;
    static getHomeFileHistoryFilePath(sessionId: string, backupName: string): string;
    static getHomeDir(): string;
    static getHomeAgentsDir(): string;
    static getHomePluginsDir(): string;
    static getPlansDir(): string;
    static getBlobsDir(): string;
    static getBlobPath(blobId: string, mime?: string): string;
    private static readonly MIME_EXT_MAP;
    static mimeToExt(mime: string): string;
    static getTeamsDir(): string;
    static getTeamDir(teamName: string): string;
    static getTeamInboxesDir(teamName: string): string;
    static getTeamInboxPath(teamName: string, memberName: string): string;
    static getTeamConfigPath(teamName: string): string;
    static getTeamMemberEndpointPath(teamName: string, memberName: string): string;
    static getTeamTasksDir(teamName: string): string;
    static getHomeMemoriesDir(): string;
    static getProjectMemoryDir(projectId?: string): string;
    static getGlobalMemoryDir(): string;
    static getColleagueMemoryDir(agentKey: string, projectId?: string): string;
    static getTeamMemoryDir(userId: string): string;
    static getTasksDir(): string;
    static getSessionTasksDir(sessionId: string): string;
    static getWorkflowsDir(): string;
    static getWorkflowsDirForRun(sessionId: string, projectId?: string): string;
    static getWorkflowScriptsDirForRun(sessionId: string, projectId?: string): string;
    static getWorkflowRunRecordPath(sessionId: string, runId: string, projectId?: string): string;
    static getWorkflowScriptSnapshotPath(sessionId: string, workflowName: string, sourceRunId: string, projectId?: string): string;
    static getSubagentWorkflowDir(sessionId: string, runId: string, projectId?: string): string;
    static getWorkflowRunJournalPath(sessionId: string, runId: string, projectId?: string): string;
    static getSessionHistoryDir(projectId?: string): string;
    /**
     * 后台 bash 任务的输出落盘**根目录**：`{os.tmpdir()}/codebuddy-{userTag}/{cwdHash}/`。
     *
     * 用临时目录而不是 `~/.codebuddy/` 的原因（对齐 Claude Code）：
     *  - 这是临时数据：codebuddy 进程死掉后 `backgroundTasks` Map 清空，留着日志没人能读
     *  - 系统重启时操作系统会自动清理 `/tmp`，避免文件累在用户主目录
     *  - macOS/Linux 的 `/tmp`（或 `/var/folders/.../T/`）通常已在 sandbox readable allowlist
     *
     * `userTag` 隔离不同用户在共享 `/tmp` 上的冲突：
     *  - POSIX：用 `process.getuid()`（数字 uid，跨进程稳定）
     *  - Windows：用 `os.userInfo().username`（uid 在 Windows 上不存在，所有 fallback 到 0
     *    会让多用户机器共享同一目录 → 隐私/冲突隐患）
     *
     * `{cwdHash}` 用 {@link compressPath} 把工作目录绝对路径压成安全目录名，让同一台机器上
     * 在不同项目跑的 codebuddy 互不干扰。
     *
     * @param cwdHash 可选，绕过 IoC（用于单测）；生产代码不传，走 {@link getCompressedWorkDir}。
     */
    static getBgTasksRootDir(cwdHash?: string): string;
    /**
     * 拿一个跨平台、对单用户稳定的标识符用于临时目录隔离。
     * 公开给测试用（绑定 process.getuid 行为）。
     *
     * @param overrides 可选注入点（仅测试用）：
     *   - getUid：模拟 `process.getuid`；传 `undefined` 模拟 Windows 平台
     *   - getUsername：模拟 `os.userInfo().username`；可让其抛异常以验证 fallback
     */
    static getUserTag(overrides?: {
        getUid?: () => number | undefined;
        getUsername?: () => string;
    }): string;
    /**
     * 单个 session 的后台任务输出目录：`{bgTasksRoot}/{sessionId}/bg-tasks/`。
     *
     * sessionId 必填——session 隔离让 session 切换 / 退出时整目录直接 `rm -rf`，
     * 不需要按 task 一个个 unlink。详见 tool-manager.ts 的 killBackgroundTasksBySessionId。
     *
     * @param cwdHash 可选，透传给 {@link getBgTasksRootDir}（用于单测）。
     */
    static getSessionBgTasksDir(sessionId: string, cwdHash?: string): string;
    static getProjectHomeDirFor(workspaceRoot: string, paths?: typeof path): string;
    /**
     * 项目级配置目录（默认 `<workDir>/.codebuddy`），是项目级 settings 与项目内
     * 用户 memory 等的落盘根。
     *
     * 安全（issue #116241）：默认目录名 `.codebuddy` 固定且随 git 仓库分发，投毒者
     * 可在仓库根放 `.codebuddy/settings.json`（如注入 `env.CODEBUDDY_BASE_URL`）劫持
     * LLM endpoint，使携 OAuth token 的请求外发。`CODEBUDDY_PROJECT_CONFIG_DIR` 允许
     * 把项目级配置目录改名或指向受控绝对路径，令固定投毒面失效：
     *   - 未设置 / 空白：沿用默认 `.codebuddy`（行为不变）
     *   - 相对值：相对 workDir 解析（如 `.mycorp` → `<workDir>/.mycorp`）
     *   - 绝对路径：直接使用（可指向 workDir 外的受控目录）
     *
     * 该值来自用户级环境变量（可信来源，攻击者无法经仓库投毒设置），与用户级
     * `CODEBUDDY_CONFIG_DIR` 成对。
     */
    static getProjectHomeDir(paths?: typeof path): string;
    static getProjectAgentsDir(): string;
    static getHomeSkillsDir(paths?: typeof path): string;
    /** 自定义命令目录约定（进程档 provider 与会话档扫描共用，路径漂移单点）。 */
    static getHomeCommandsDir(paths?: typeof path): string;
    /**
     * Connector-installed skills directory: `$CODEBUDDY_CONFIG_DIR/connectors/skills/`.
     *
     * Connector 产品会把安装的 skill 文件放到这里（目录结构 `connectors/skills/connector-{id}/SKILL.md`），
     * 与用户自装 skill 分开，便于 UI 按来源过滤（不展示）而 agent 仍可感知（注入 prompt）。
     */
    static getHomeConnectorSkillsDir(paths?: typeof path): string;
    static getProjectSkillsDir(paths?: typeof path): string;
    static getBuiltinSkillsDir(): string | undefined;
    static getLoggerDir(): string;
    static getDebugLogDir(): string;
    static getDebugLogFile(sessionId?: string): string;
    static getBinDir(): string;
    static getWorkDir(): string;
    static getDarwinPaths(appName: string): DirectoryPaths;
    static getWin32Paths: (appName: string) => DirectoryPaths;
    static getLinuxPaths(appName: string): DirectoryPaths;
    static getAppPaths(appName: string, { suffix }?: {
        suffix?: string;
    }): DirectoryPaths;
    /**
     * 非字符串路径预览在错误信息里的长度上限。错误信息会作为工具输出进入模型上下文，
     * 必须有界。
     */
    private static readonly NON_STRING_PATH_PREVIEW_MAX_CHARS;
    /**
     * 把非字符串路径入参渲染成一段简短、可读的预览，供 {@link resolveFilePathToWorkDir}
     * 的类型守卫拼进错误信息。
     *
     * 三条硬约束：
     *  1. **永不抛**。`JSON.stringify` 遇到循环引用会抛 "Converting circular structure to
     *     JSON"、遇到 BigInt 会抛 "Do not know how to serialize a BigInt"；自定义 `toString`
     *     也可能抛。守卫的全部价值就是"任何情况下都给出可读信息"，它自己有个会崩的分支
     *     等于自我抵消——那样模型收到的又变回一条无意义的内部错误。
     *  2. **有长度上限**。这条错误会作为工具输出进入模型上下文；实测一个 5KB 的对象参数
     *     会生成 5000+ 字符的消息。上限与 runner-factory 对畸形参数的回显口径一致。
     *  3. **尽量保留可辨识信息**。`JSON.stringify` 对 function/undefined 返回 undefined，
     *     此时退回 `String()`，而不是直接丢掉。
     */
    private static describeNonStringPath;
    static resolveFilePathToWorkDir(filePath: string, rootDirectory?: string): string;
    /**
     * 归一化用作 checkpoint 文件 key 的绝对路径,消除 Windows 盘符大小写差异。
     *
     * checkpoint 用绝对路径字符串作为 Record key 跨快照匹配文件。但同一文件的绝对路径
     * 在不同来源下盘符大小写可能不同:
     *   - trackFile: path.resolve(模型传入路径),盘符大小写取决于模型/workspace(如 c:\)
     *   - 从快照相对路径还原: path.resolve(相对key),盘符大小写取决于 process.cwd()(如 C:\)
     * 两者不一致会导致 revertFiles 里 revertFileVersions[key] 查找 miss、误入"文件未跟踪"
     * 分支,回退到错误版本。Windows 文件系统盘符大小写不敏感,这里统一为大写(平台惯例)
     * 使两侧 key 一致。非 Windows 平台路径大小写敏感,保持原样。
     */
    static normalizeCheckpointPath(filePath: string): string;
    /**
     * Normalize path separators for cross-platform compatibility.
     * Converts Windows backslashes to forward slashes on non-Windows platforms.
     * This is needed because models may generate Windows-style paths (e.g., "foo\bar\baz")
     * even when running on Unix-like systems (WSL, Linux, macOS).
     *
     * On Windows, backslashes are preserved as they are valid path separators.
     * On Unix-like systems, backslashes are converted to forward slashes.
     */
    static normalizePathSeparators(filePath: string): string;
    static unixToWindowsPath(unixPath: string): string;
    static getCompressedWorkDir(): string;
    /**
     * storeId 派生缓存：realpathSync 有 syscall 成本，同一进程内同一 dir 反复查询。
     * key 是入参原样字符串，value 是 realpath 之后的物理路径（或原样字符串，见下方降级）。
     * 缓存有界：项目 storeId 派生的输入空间就是"用户 cwd + 若干 sandbox 工作目录"，
     * 不会失控膨胀。
     */
    private static readonly storeCanonicalCache;
    /**
     * 把任意目录路径归一化为其**物理路径**，供 storeId 派生使用。
     *
     * 背景 —— issue 17577822（深信服 UEM 虚拟磁盘挂载）+ genie/genie#58340（Windows 双盘符）：
     *   同一目录在系统里同时有两种字符串表示（用户短路径 `/Users/foo` 与物理路径
     *   `/Volumes/sangfor/uem_disk_.../Users/foo`），不同调用点看到不同表示：
     *     - SessionStore 走 workspace.workspaceFolders[0].uri.fsPath —— 短路径
     *     - ToolResultBlobService / SandboxOrchestrator 侧 cwd 已被下游 realpath 归一化 —— 物理路径
     *   两侧 `compressPath` 得到不同 storeId，同一 sessionId 被拆到两个
     *   `~/.codebuddy/projects/{storeId}` 目录，用户以为"AI 回复丢了"。
     *
     * 契约：
     *   - 存在的路径：返回 `realpathSync(dir)`（macOS 会把 `/var` 解到 `/private/var`；
     *     Linux/UEM 会把软链短路径解到物理挂载点；Windows 会解到最终盘符路径）。
     *   - 不存在的路径：**降级返回原样字符串**，不抛。理由：`storage-service` /
     *     `local-jobs-controller` 会在 cwd 还未落盘（例如 sandbox launcher 的虚拟目录、
     *     job 尚未 mkdir 的工作目录）时就派生 storeId，realpath 抛错会导致 IO 链路整体
     *     失败。降级到"原样字符串"也是安全的：这类路径本来就没有 symlink 二义性。
     *   - 其他错误（EACCES、ELOOP 等）：同样降级为原样字符串，日志层可自行观测。
     *
     * 缓存：进程级 Map 缓存，key 是入参原样字符串，避免每次派生 storeId 都 syscall。
     */
    static canonicalizeStorePath(dir: string): string;
    /** 兼容入口：备份比较形态由 sandbox-cli 运行时包统一实现。 */
    static toBackupComparablePath(targetPath: string): string;
    /** 兼容入口：备份 payload 形态由 sandbox-cli 运行时包统一实现。 */
    static toBackupPayloadPath(targetPath: string): string;
    /** @deprecated 语义已拆分：判定用 {@link toBackupComparablePath}。 */
    static toBackupAuthorityPath(targetPath: string): string;
    /**
     * Compress an arbitrary directory path into a safe directory name.
     * Replaces path separators and colons with dashes and normalizes; when the
     * result exceeds the single-segment byte limit (NAME_MAX=255) it is
     * truncated on a codepoint boundary and suffixed with a stable djb2 hash.
     *
     * Example: '/Users/ericffan/my-project' → 'Users-ericffan-my-project'
     *
     * ⚠️ 算法真源在 './compress-path.source.ts'，改算法只改那个文件。此处仅委托。
     */
    static compressPath(dir: string): string;
    static shortenPath(filePath: string, maxLen?: number): string;
    static getRelativePath(targetPath: string, workDir?: string): string;
    /**
     * Get a display-friendly path.
     * - If the path is under workDir, display as relative path
     * - If the path is in workDir's parent chain (../), display as relative path
     * - If the path is under home directory but far from workDir, display as ~/...
     * - If the relative path has many "../" segments and path suggests home directory content, display as ~/...
     * - Otherwise, display as relative path to workDir
     *
     * @param targetPath - The path to display
     * @param workDir - The working directory (default: current workDir)
     * @returns A display-friendly path string
     */
    static getDisplayPath(targetPath: string, workDir?: string): string;
    static getBunMainPath(): string;
    static isBunCompiled(): boolean;
    /**
     * 构造「重新拉起自身可执行文件」时该传的 argv（不含 execPath 本身）。
     *
     * Node.js 下 `process.execPath` 是 node 二进制，子进程必须显式把入口脚本
     * （`entry`，即 `process.argv[1]`）作为第一个参数，否则 node 不知道要跑什么：
     * `spawn(execPath, [entry, ...args])`。
     *
     * Bun SFE（`bun build --compile`）下 `process.execPath` 本身就是完整的 CLI
     * 可执行文件——它不需要也不能再接受一个入口脚本参数。此时 `entry`
     * (`process.argv[1]`) 是虚拟路径（`/$bunfs/root/<bin>`），把它当成普通参数
     * 传给子进程，子进程会把这个虚拟路径误判成 argv[2]（commander 的
     * positional `[prompt]`），从而把它当作用户输入的 query 处理——外部表现为
     * 「黑屏后自动拉起一个带诡异 query 的新会话」，且新会话再次触发同样的
     * 自举重入路径，形成递归 fork（issue #82398）。
     *
     * 用 `bun build --compile` 实测验证：`spawn(execPath, [entry, ...args])`
     * 在 Bun SFE 下产出的子进程 argv 是
     * `["bun", "<own-bunfs-path>", "<entry-value>", ...args]`——`entry` 被当成
     * 普通参数追加在 argv[2]，而不是被识别为「入口脚本」。
     */
    static buildRespawnArgs(entry: string, args?: readonly string[]): string[];
    /**
     * 「由外部（系统服务 / tmux shell / 其它进程）重新拉起本 CLI」的完整 argv 前缀：
     * `[可执行文件, ...execArgv?, entry?]`，后面直接接子命令即可。
     *
     * 与 `buildRespawnArgs` 的区别：调用方要把结果持久化（systemd unit / plist / 计划任务）
     * 或交给不继承本进程环境的 shell，因此：
     * - Bun SFE 下可执行文件取**稳定入口**而不是 `process.execPath`：官方安装把
     *   `<bindir>/<bin>` 软链到 `<versiondir>/<ver>/<bin>`，execPath 解析到的是带版本号的
     *   真实文件，写进系统服务会把服务钉死在当前版本——升级不生效、旧版本被清理后启动失败；
     * - Node.js 下保留 `process.execArgv`（如 lowmem 的堆参数），与 daemon/bg spawn 一致。
     *
     * `ELECTRON_RUN_AS_NODE` 宿主（WorkBuddy Desktop 内嵌 CLI）下 execPath 是 Electron 本体，
     * 只有带着该环境变量才是 node；调用方若不能传递环境，需要用 `requiresElectronRunAsNode` 判断。
     */
    static buildSelfLauncher(entry: string, options?: {
        executable?: string;
        includeExecArgv?: boolean;
    }): string[];
    /** 当前进程是否靠 `ELECTRON_RUN_AS_NODE` 才以 node 身份运行（execPath 是 Electron 本体）。 */
    static requiresElectronRunAsNode(): boolean;
    /**
     * 官方安装布局下把 `<versiondir>/<ver>/<bin>` 映射回稳定入口 `<bindir>/<bin>`；
     * 仅当稳定入口确实存在且解析到同一个文件时才替换，其它安装方式原样返回。
     */
    static resolveStableExecutable(executable: string): string;
    static getRootPath(): Promise<string>;
    static getRootPathSync(): string;
    /**
     * Resolve a relative path to absolute path based on CLI executable root
     */
    static resolveRootPathSync(relativePath: string): string;
    /**
     * from: https://github.com/sindresorhus/is-path-inside/blob/main/index.js
     */
    static isPathInside(childPath: string, parentPath: string): boolean;
    static resolveRealPath(filePath: string): Promise<string | null>;
}
export {};
