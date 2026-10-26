/**
 * 入库率端侧 watcher 的「多仓发现」共享逻辑（git / svn 通用）。
 *
 * 同时覆盖两类打开方式：
 *   1. 直接打开仓库（或其子目录）：沿父链向上找到唯一仓库根，返回该根。
 *   2. 打开一个父目录、其下挂多个独立仓库：向下有限层扫描子目录，
 *      把每个仓库根收集出来，命中后剪枝不再深入。
 *
 * 向下扫描在 cwd 为 home 等超大目录时代价很高（实测 home 深度 3 约 3 万个目录、
 * 同步 readdir 阻塞事件循环数秒），因此：
 *   - 子目录枚举走异步 IO，不阻塞事件循环；
 *   - 跳过隐藏目录与 home 下的 `Library`（工具缓存 / 系统数据，不是用户仓库）；
 *   - 用目录数预算兜底，超限即停止；
 *   - 只输出起止两条诊断日志，不再逐目录打日志。
 *
 * 纯函数 + 依赖注入，便于单测，不直接耦合真实 fs / 具体 VCS 判定。
 */
/** 向下扫描发现多仓时的最大深度。深度 1~2 即可覆盖常见场景，3 兼容 `group/project` 再套一层。 */
export declare const DEFAULT_REPO_SCAN_MAX_DEPTH = 3;
/** 向下扫描发现的仓库数量上限，避免在超大目录树里无限扫描。 */
export declare const DEFAULT_MAX_VCS_REPOS = 50;
/** 向下扫描访问的目录数上限；正常工作区（含 monorepo）远低于该值。 */
export declare const DEFAULT_MAX_SCANNED_DIRS = 5000;
/** 向下扫描时跳过的噪音目录，避免进 node_modules / 构建产物等大目录。隐藏目录另由前缀规则统一跳过。 */
export declare const REPO_SCAN_SKIP_DIR_NAMES: Set<string>;
export interface VcsRootDiscoveryDeps {
    /** 沿父链向上找仓库根。返回 undefined 表示 cwd 及其祖先都不是仓库。 */
    findUpRoot?: (startPath: string) => string | undefined;
    /** 判断某目录是否是仓库根。 */
    isRoot?: (dir: string) => boolean;
    /** 列出某目录下的直接「子目录绝对路径」。 */
    listSubdirectories?: (dir: string) => string[] | Promise<string[]>;
    /** 向下扫描最大深度。 */
    maxDepth?: number;
    /** 发现的仓库数量上限。 */
    maxRepos?: number;
    /** 向下扫描访问的目录数上限。 */
    maxScannedDirs?: number;
    /** 用户 home 目录；用于跳过 `<home>/Library`。默认 `os.homedir()`。 */
    homeDir?: string;
    /** 可选的诊断回调：用于把扫描过程打到日志，便于线上定位「为什么没发现仓库」。 */
    onTrace?: (msg: string) => void;
}
export declare function discoverVcsRoots(cwd: string, deps?: VcsRootDiscoveryDeps): Promise<string[]>;
export declare function defaultListSubdirectories(dir: string): Promise<string[]>;
