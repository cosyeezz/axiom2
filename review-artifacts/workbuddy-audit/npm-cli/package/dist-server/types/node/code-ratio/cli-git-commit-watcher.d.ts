import { Application, ApplicationLifecycle } from '@celljs/core';
import { type ICwdService } from '@genie/cbc-worktree';
import { ProductManager } from '@genie/product';
import { type IPrewarmStateService } from '../prewarm/prewarm-protocol';
/**
 * CLI 端的 git commit 监听 + 上报。
 *
 * 设计要点（对齐 plugin-core 但只做 CLI 必要的部分）：
 *
 *   - **多仓**：从 `process.cwd()` 出发发现「全部」git 仓库——
 *     既兼容「直接打开仓库（或其子目录）」（沿父链向上找 `.git`），
 *     也兼容「打开一个父目录、其下挂多个独立仓库」（向下有限层扫描）。
 *     每个仓库各自监听 `.git/logs/HEAD`、各自维护 lastHead、各自上报。
 *   - 监听 `.git/logs/HEAD`（reflog）：覆盖手动 `git commit` / agent Bash 工具
 *     发起的 commit / `git commit --amend` / rebase 等所有动 HEAD 的操作。
 *   - 进程退出前再 flush 一次：CLI 是短命进程，最后一次 commit 完成到 fs.watch
 *     回调真正触发之间可能有几十 ms 间隙，由 watcher.flushOnExit() 兜底。
 *   - lastHead 持久化到 `~/.codebuddy/code-ratio/cli-watcher-lastHead-<hash>`（按 repoRoot 区分）：
 *     CLI 重启后能识别"上次跑完之后又有新 commit"并补上报，避免漏；同时也避免
 *     启动瞬间把当前 HEAD 当成新 commit 重复报。
 *   - feature gate 不在 watcher 里判：`reporter.observeCommit()` 已经做过
 *     `isCodeAdoptionRateEnabled` 检查，运行时切换开关也能立即生效。
 */
export declare class CliGitCommitWatcher implements ApplicationLifecycle<Application> {
    protected readonly productManager?: ProductManager;
    protected readonly cwdService?: ICwdService;
    protected readonly prewarmState?: IPrewarmStateService;
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
    private initializationStarted;
    private activationDeferred;
    initialize(): void;
    /**
     * 入库率 feature gate + late-enable 订阅（对齐 plugin-core GitCommitWatcher）。
     *
     * 仓库发现扫描（readdirSync 递归）、watcher attach、startup 扫描的开销都在
     * feature gate 之后才发生——未启用入库率能力时，进程**完全不做**仓库发现，
     * 避免预热池默认开启后对错误继承的 home 目录做大量无意义扫描。
     *
     * ProductManager 未注册（headless / 单测）时保守退回：直接走 cwd 订阅，
     * 不阻断原有采集路径。
     */
    private mountWhenEnabled;
    /**
     * 订阅 cwd 变更，把 attach 绑到最新 cwd（对齐 ConfigWatchService）。
     *
     * BehaviorSubject 语义：订阅瞬间即收到「当前 cwd」种子值 → 首轮 attach；
     * 之后任何 setCwdState（预热 activate 后 chdir、worktree 切换）都会再次推送
     * → 先 dispose 旧 watcher 再按新 cwd 重新 attach。
     *
     * 预热待机期 initialize() 整体延后到 activation，因此订阅时收到的种子值已经是
     * activate 后的 workspace cwd，不会扫描冷启动继承的 home。
     *
     * CwdService 未注册（单测）时退回：直接 attach 一次。
     */
    private subscribeCwd;
    /**
     * 暴露给 process.ts 的 exit 钩子调用，确保最后一个 commit 不会被丢。
     * 永不抛错。
     */
    flushOnExit(): Promise<void>;
    /**
     * 让 Bash 工具的 post-exec hook 在跑完 `git commit` 后立即调一下，
     * 不必等 reflog 事件。永不抛错。
     */
    notifyExternalGitCommit(): Promise<void>;
    /** 关闭 watcher（测试 / 后续若引入显式 deactivate 时使用）。 */
    dispose(): void;
    /**
     * 关闭并清空所有仓库 watcher/timer，但**不**退订 gate/cwd。
     * 供 cwd 变更重绑复用（先 disposeWatchers 再 attachAll），dispose() 也调用它。
     */
    private disposeWatchers;
    private attachAll;
    private attachRepo;
    private scheduleScan;
    /**
     * 读 HEAD → 跟 lastHead 比 → 如果是新 commit 就走 `loadCommit` 上报。
     *
     * 若 HEAD↔lastHead 之间相差多个 commit（比如启动时补差量、rebase 后），
     * 用 `git rev-list lastHead..HEAD` 列出来按时间正序逐个上报，每个都加内存
     * 去重 + 持久化。失败时不更新 lastHead，下次再尝试。
     */
    private checkAndReport;
    /**
     * 计算需要上报的 commit 序列，时间正序。
     *
     *   - lastHead 缺失：只取 HEAD 一个。
     *   - lastHead 存在但 git rev-list 失败（被 git gc / rebase 抹掉）：fallback 也只取 HEAD。
     */
    private listNewCommits;
    /**
     * 上报单个 commit。
     *
     * 返回值语义：
     *   - `true`：成功上报
     *   - `false`：明确不可归因（merge、initial、无文件、无 repoUrl 等），可安全跳过
     *   - `'failed'`：上报失败（网络/内部错误），需要保留游标重试
     */
    private reportOne;
    /** 懒加载并缓存某仓库本地 `git config user.email`（归一化后）。读不到返回空串。 */
    private resolveLocalGitEmail;
    private trimReportedCache;
}
/**
 * 从 `cwd` 发现需要监听的全部 git 仓库根：
 *
 *   1. 先沿父链向上找：若 `cwd` 本身或其某个祖先是 git 仓库，则视为「打开了仓库
 *      （或其子目录）」，直接返回该唯一根。
 *   2. 否则向下有限层扫描子目录，把每个 git 仓库根收集出来，命中后剪枝不再深入。
 *
 * 实际扫描逻辑复用 `discoverVcsRoots`（git/svn 通用），这里只注入 git 专属判定。
 */
export declare function discoverGitRepos(cwd: string, deps?: GitRepoDiscoveryDeps): Promise<string[]>;
export interface GitRepoDiscoveryDeps {
    /** 沿父链向上找仓库根；默认用 `findRepoRootFromCwd`。 */
    findUpRoot?: (startPath: string) => string | undefined;
    /** 判断某目录是否是 git 仓库根；默认用 `GitInfoExtractor.isGitRepository`。 */
    isRepo?: (dir: string) => boolean;
    /** 列出某目录下的直接「子目录绝对路径」；默认走 fs.readdirSync。 */
    listSubdirectories?: (dir: string) => string[] | Promise<string[]>;
    /** 向下扫描最大深度。 */
    maxDepth?: number;
    /** 发现的仓库数量上限。 */
    maxRepos?: number;
    /** 诊断回调：把扫描过程打到日志。 */
    onTrace?: (msg: string) => void;
}
/**
 * 从 cwd 起向上找最近的 git 仓库根。复用 GitInfoExtractor 已有的判定，与
 * `CwdRepoResolver.findRepoRoot` 行为一致；这里不直接 import 后者，避免
 * 把 watcher 的可测试性绑死在带状态的 resolver 上。
 */
export declare function findRepoRootFromCwd(startPath: string): string | undefined;
