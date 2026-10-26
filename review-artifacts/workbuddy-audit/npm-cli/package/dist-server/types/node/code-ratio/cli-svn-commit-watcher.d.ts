import { Application, ApplicationLifecycle } from '@celljs/core';
import { type ICwdService } from '@genie/cbc-worktree';
import { ProductManager } from '@genie/product';
/**
 * CLI 端的 svn commit 监听 + 上报。
 *
 * 设计要点：
 *
 *   - **多仓**：从 `process.cwd()` 出发发现「全部」svn 工作副本——
 *     既兼容「直接打开工作副本（或其子目录）」（沿父链向上找 `.svn`），
 *     也兼容「打开一个父目录、其下挂多个独立工作副本」（向下有限层扫描）。
 *     每个工作副本各自 `fs.watch(.svn/wc.db)`、各自维护 lastRevision、各自上报。
 *   - 监听 `.svn/wc.db`：svn commit/update 都会动这个文件。
 *   - lastRevision 持久化到 `~/.codebuddy/code-ratio/cli-svn-watcher-lastRev-<hash>`，
 *     按 repoRoot 区分，CLI 重启后补差量、避免重复上报。
 *   - 用户身份过滤交给 `getLikelyCurrentSvnUserCandidates` / `isLikelyCurrentUser`，
 *     按各仓库 URL 分别匹配 auth realm，「未知身份不放行」避免 svn update 误报。
 *   - feature gate 不在 watcher 里判：`reporter.observeCommit()` 已做检查。
 */
export declare class CliSvnCommitWatcher implements ApplicationLifecycle<Application> {
    protected readonly productManager?: ProductManager;
    protected readonly cwdService?: ICwdService;
    private logger?;
    private readonly repos;
    /** feature gate 是否已判定 enabled 并触发过挂载，保证只挂一次（幂等）。 */
    private gateResolved;
    /** 等待 late-enable 的配置订阅（未启用时挂，enabled 后退订）。 */
    private gateSubscription?;
    /** cwd 变更订阅（首轮种子值 attach、之后变更重绑）。 */
    private cwdChangeSubscription?;
    /** 标记是否已完成首轮 attach，区分种子值与后续 cwd 变更。 */
    private attachedOnce;
    /** 每次 disposeWatchers 递增；异步发现完成时代际不一致说明 cwd 已变或已 dispose，丢弃结果。 */
    private attachGeneration;
    initialize(): void;
    /**
     * 入库率 feature gate + late-enable 订阅（对齐 git watcher / plugin-core）。
     *
     * 未启用入库率能力时**完全不做** svn 工作副本发现扫描 / watcher / 轮询定时器，
     * 避免预热池默认开启后对错误继承的 home 目录做大量无意义扫描。
     * ProductManager 未注册（headless / 单测）时保守退回：直接走 cwd 订阅。
     */
    private mountWhenEnabled;
    /**
     * 订阅 cwd 变更，把 attach 绑到最新 cwd（对齐 ConfigWatchService）。
     * 首轮种子值 attach、之后 cwd 变更先 dispose 旧 watcher 再按新 cwd 重新 attach。
     * CwdService 未注册（单测）时退回：直接 attach 一次。
     */
    private subscribeCwd;
    /**
     * 是否仍处于预热（prewarm）待机态：argv 含 `--prewarm` 且 PrewarmServer 状态
     * 为 `idle`（尚未收到 activate）。详见 git watcher 同名方法的说明。
     *
     * 待机时跳过首轮 attach，等 activate 后 dispatcher 的 cwd 广播（状态已转为
     * activating）再绑定，避免对错误继承的 home 做工作副本发现扫描。
     */
    private isPrewarmStandby;
    flushOnExit(): Promise<void>;
    notifyExternalSvnCommit(): Promise<void>;
    dispose(): void;
    /**
     * 关闭并清空所有工作副本 watcher/timer，但**不**退订 gate/cwd。
     * 供 cwd 变更重绑复用（先 disposeWatchers 再 attachAll），dispose() 也调用它。
     */
    private disposeWatchers;
    private attachAll;
    private attachRepo;
    private scheduleScan;
    private checkAndReport;
}
export interface SvnDiscoveryDeps {
    /** 沿父链向上找工作副本根；默认用 `findSvnWorkingCopyRoot`。 */
    findUpRoot?: (startPath: string) => string | undefined;
    /** 判断某目录是否是 svn 工作副本根；默认用 `isSvnWorkingCopy`。 */
    isWorkingCopy?: (dir: string) => boolean;
    /** 列出某目录下的直接「子目录绝对路径」；默认走 fs.readdirSync。 */
    listSubdirectories?: (dir: string) => string[] | Promise<string[]>;
    /** 向下扫描最大深度。 */
    maxDepth?: number;
    /** 发现的工作副本数量上限。 */
    maxRepos?: number;
    /** 诊断回调：把扫描过程打到日志。 */
    onTrace?: (msg: string) => void;
}
/**
 * 从 `cwd` 发现需要监听的全部 svn 工作副本根：
 *
 *   1. 先沿父链向上找：若 `cwd` 本身或其某个祖先是工作副本，则视为「打开了工作
 *      副本（或其子目录）」，直接返回该唯一根（其下子目录都属于同一个 wc）。
 *   2. 否则向下有限层扫描子目录，把每个含 `.svn` 的目录当成独立工作副本根，
 *      命中后剪枝不再深入（兼容 svn 1.7+「整棵 wc 只有顶层一个 .svn」的布局，
 *      也避免把 1.6 时代每级目录的 .svn 误判成多个仓库）。
 *
 * 纯函数 + 依赖注入，便于单测，不直接耦合真实 fs。
 */
export declare function discoverSvnWorkingCopies(cwd: string, deps?: SvnDiscoveryDeps): Promise<string[]>;
interface SvnUserCandidateOptions {
    env?: NodeJS.ProcessEnv;
    repoUrls?: Array<string | undefined>;
    authCacheDirs?: string[];
    readDir?: (dirPath: string) => string[];
    readFile?: (filePath: string) => string;
}
/**
 * 计算当前 SVN 用户候选集。不再与操作系统登录用户绑定：
 *   - 显式环境变量 `SVN_USER` / `SVN_USERNAME`；
 *   - SVN auth cache（`~/.subversion/auth/svn.simple/*` 或 Windows `%APPDATA%`），
 *     按当前仓库 URL 匹配 realm 后取 username。
 * 读不到任何身份时返回空数组，调用方据此「未知身份不放行」，避免 svn update 误报。
 */
export declare function getLikelyCurrentSvnUserCandidates(options?: SvnUserCandidateOptions): string[];
export declare function isLikelyCurrentUser(author: string | undefined, currentUserCandidates?: string[]): boolean;
export {};
