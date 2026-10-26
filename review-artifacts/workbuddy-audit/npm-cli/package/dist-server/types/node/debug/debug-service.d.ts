import { DebugConfig, DebugFilter, DebugOptions, DebugService } from './debug-protocol';
export declare class DebugServiceImpl implements DebugService {
    private sessionManager;
    private shouldStringifyMultiline;
    private config;
    private currentSessionId;
    private messageCache;
    private sessionSubscription;
    protected initialize(): void;
    dispose(): void;
    initializeConfig(config: DebugConfig): void;
    isDebugEnabled(): boolean;
    isDebugToStderr(): boolean;
    getDebugFilter(): DebugFilter | null;
    shouldDebugMessage(message: string): boolean;
    setStringifyMultiline(enabled: boolean): void;
    debug(message: string, options?: DebugOptions): void;
    private appendToFile;
    parseTruthy(value?: string): boolean;
    parseDebugFilter(filterString: string): DebugFilter | null;
    private extractDebugCategories;
    private shouldFilterMessage;
    private passesDebugFilter;
    private writeToStderr;
    private createLatestSymlink;
}
