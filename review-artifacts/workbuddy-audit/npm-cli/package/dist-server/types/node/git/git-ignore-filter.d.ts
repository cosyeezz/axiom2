import { Workspace } from '@genie/runtime';
import { GitIgnoreFilter } from './git-protocol';
export declare class GitIgnoreFilterImpl implements GitIgnoreFilter {
    protected readonly workspace: Workspace;
    private projectRoot;
    private ig;
    private patterns;
    /** 初始化 Promise，用于等待异步加载完成 */
    private initPromise?;
    init(): void;
    isIgnored(filePath: string): boolean;
    getPatterns(): string[];
    /**
     * 等待初始化完成（可选，用于需要确保模式已加载的场景）
     */
    waitForInit(): Promise<void>;
    private loadGitRepoPatternsAsync;
    private loadPatternsAsync;
    private addPatterns;
}
