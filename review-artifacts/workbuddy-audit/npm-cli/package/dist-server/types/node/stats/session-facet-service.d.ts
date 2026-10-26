import { Logger } from '@genie/telemetry';
import { PromptRenderer } from '../../vendor/cbc-core/node/index.js';
import { SessionFacet, SessionFacetService, SessionAnalysisProgressCallback } from './insights-protocol';
export declare class SessionFacetServiceImpl implements SessionFacetService {
    protected readonly promptRenderer: PromptRenderer;
    protected readonly logger: Logger;
    getFacetsDir(): string;
    analyzeAllSessions(language?: string, onProgress?: SessionAnalysisProgressCallback, signal?: AbortSignal): Promise<SessionFacet[]>;
    /**
     * 加载 facets 目录下所有已有的 facet JSON
     */
    private loadExistingFacets;
    /**
     * 分批处理需要分析的 session 文件
     * 对每个文件：读取历史 → 构建 transcript → 分析 → 保存 facet
     */
    private analyzeFilesBatched;
    /**
     * 直接从文件读取 session 历史并分析
     * 不需要完整的 Session 对象反序列化，只读取足够构建 transcript 的历史条目
     */
    private analyzeSessionFile;
    /**
     * 保存错误标记 facet，避免反复重试失败的 session
     * 下次运行时如果 session 文件没被修改，就跳过
     */
    private saveErrorFacet;
    /**
     * 从历史条目构建可读的 transcript 文本
     * 限制大小避免 prompt 过长
     */
    private buildTranscriptFromHistory;
    /**
     * 从 content 字段提取纯文本
     */
    private extractText;
    /**
     * 按行读取 .jsonl 文件，只解析前 maxLines 条有效记录
     * 使用 readline 流式读取，避免将整个大文件加载到内存
     */
    private readHistoryLines;
    /**
     * 解析模型返回的 JSON
     */
    private parseJsonResponse;
}
