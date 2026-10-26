import { Logger } from '@genie/telemetry';
import { ConditionalRulesService, ConditionalRulesState, ConsumeResult, GlobMatcher, MemoryManager, SubdirectoryMemoryLoader } from './memory-protocol';
export declare class ConditionalRulesServiceImpl implements ConditionalRulesService {
    protected readonly memoryManager: MemoryManager;
    protected readonly globMatcher: GlobMatcher;
    protected readonly logger: Logger;
    protected readonly subdirLoader: SubdirectoryMemoryLoader;
    consume(state: ConditionalRulesState): Promise<ConsumeResult>;
    /**
     * 查找匹配的规则
     */
    private findMatchingRules;
    /**
     * 构建注入内容
     */
    private buildInjectionContent;
    /**
     * 检查规则是否匹配触发路径
     */
    private matchesRule;
}
