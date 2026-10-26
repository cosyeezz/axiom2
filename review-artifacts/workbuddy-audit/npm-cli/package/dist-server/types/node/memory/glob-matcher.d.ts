import { GlobMatcher } from './memory-protocol';
export declare class GlobMatcherImpl implements GlobMatcher {
    matches(filePath: string, globs: string[]): boolean;
    /**
     * 匹配单个 glob 模式
     */
    private matchSingleGlob;
    /**
     * 获取相对于 workDir 的路径
     *
     * 注意：每次调用都现算 workDir（而非构造期缓存），以兼容 cwd 中途变更
     * （如 prewarm 进程 activate 后 chdir）。PathUtils.getWorkDir() 内部走
     * CwdService，开销可忽略。
     */
    private getRelativePath;
}
