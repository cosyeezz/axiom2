import { AgentRunInterceptor, AgentRunInterceptorPriority, AgentRunRequest } from '../../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { ImageBlobService } from '../../blob-store';
import { ConditionalRulesService } from '../../memory';
import { ReferenceService } from '../../references/reference-protocol';
import { ReadFileStateService } from '../../tools';
export declare class ReferencePathProcessorAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly readFileStateService: ReadFileStateService;
    protected readonly referenceService: ReferenceService;
    protected readonly logger: Logger;
    protected readonly imageBlobService: ImageBlobService;
    private readonly MAX_FILE_SIZE;
    private readonly MAX_TEXT_FILE_SIZE;
    intercept(request: AgentRunRequest): Promise<void>;
    private getFileSize;
    private sendBashNotification;
    private sendReadNotification;
    private sendNotificationToUI;
    private processUserMessageFiles;
    private processTextForFilePaths;
    /** Reads one `@` file into the prompt: official `PromptMentionAttached` (or null for nothing read). */
    private readMentionedFile;
    /**
     * A quoted file badge (`@"…"`, which the resource-link encoder writes for any
     * path outside `[A-Za-z0-9_./-]`, e.g. non-ASCII characters or spaces) cannot
     * be read by the `@path` syntax, which stops at the quote and the first space.
     * When it is a structured `file://` reference, its URI names the file instead.
     */
    private extractReferencedPaths;
    private resolvePath;
    private isDirectory;
    private isImageFile;
    private isTextFile;
    private createImageContent;
    private createDirectoryContent;
    private createTextContent;
}
/**
 * 条件规则注入拦截器
 * 处理 @ 文件引用触发的条件规则匹配和注入
 */
export declare class ConditionalRulesAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly conditionalRulesService: ConditionalRulesService;
    intercept(request: AgentRunRequest): Promise<void>;
}
