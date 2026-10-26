export declare abstract class GitUtils {
    /**
     * 硬编码忽略的文件/目录列表
     *
     * 设计原则：最小化硬编码
     * - 仅硬编码 .git 目录（版本控制内部文件）
     * - 其他忽略规则完全依赖项目的 .gitignore 文件
     * - 用户可通过 settings.json 的 ignorePatterns 添加额外忽略
     *
     * 这样设计的原因：
     * 1. 不同项目对 lib/build/bin 等目录有不同用途（源码 vs 构建产物）
     * 2. 项目的 .gitignore 已经定义了应该忽略的内容
     * 3. 避免误杀导致用户无法搜索到需要的文件
     */
    static readonly IGNORE_FILES: string[];
    /**
     * Unreal Engine 项目的默认排除目录
     *
     * 仅在 cwd 检测到 `*.uproject` 文件时自动叠加到 ripgrep 排除清单中。
     * 这些都是 UE 编译产物 / IDE 缓存目录，正常开发不需要搜到。
     *
     * 设计原则：
     * - 不包含 .uasset / .umap / .pak 等资源文件后缀（虽然是二进制但模型
     *   偶尔需要搜资源引用关系，由用户主动 glob 过滤即可）
     * - 仅目录级别，不猜测内容
     *
     * 用户可通过 `settings.disableUEAutoExclude=true` 关闭自动生效。
     */
    static readonly UE_IGNORE_DIRS: string[];
    /**
     * 检测给定目录是否为 Unreal Engine 项目（顶层存在 *.uproject 文件）。
     * 仅检测顶层，不递归，避免在大仓里扫描所有子目录。
     */
    static isUnrealEngineProject(directory: string): boolean;
    static isGitRepository(directory: string): boolean;
    static findGitRoot(directory: string): string | undefined;
    static shouldIgnoreGitIgnore(): Promise<boolean>;
    static getIgnoreFiles(): Promise<string[]>;
    /**
     * 获取 Git 用户名 (git config user.name)
     * @returns Git 用户名，如果获取失败返回 undefined
     */
    static getGitUserName(): string | undefined;
}
