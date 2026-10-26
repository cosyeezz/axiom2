import { AgentRunInterceptor, AgentRunInterceptorPriority, AgentRunRequest } from '../../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { ImageBlobService } from '../../blob-store';
import { SettingsManager } from '../../settings';
/**
 * ImageRehydration 拦截器
 *
 * 在 API 请求发出前处理历史中的图片：
 * - 最近 N 轮用户消息中的 ImageBlobRef → 还原为完整 base64 data URI
 * - 更早轮次的 ImageBlobRef → 替换为文本占位符（含来源和路径信息）
 *
 * 优先级 1050：在 History(1400) 注入完整历史之后，在 State(1000) 之前执行
 */
export declare class ImageRehydrationAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly imageBlobService: ImageBlobService;
    protected readonly settingsManager: SettingsManager;
    protected readonly logger: Logger;
    intercept(request: AgentRunRequest): Promise<void>;
    /**
     * 检查单个 item 是否包含 ImageBlobRef
     */
    private itemContainsBlobRef;
}
/**
 * 图片压缩拦截器
 *
 * 对 user message 中的 base64 图片进行长边压缩（默认 2000px），
 * 确保无论图片来源（ACP / plugin-chat / TUI 粘贴）都统一压缩。
 *
 * 只做尺寸压缩，不做大小限制，不会丢弃图片。
 *
 * 优先级 1075：在 ImageRehydration(1050) 之前，在 MemoryContext(1150) 之后
 */
export declare class ImageCompressionAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly logger: Logger;
    protected init(): void;
    intercept(request: AgentRunRequest): Promise<void>;
    private compressImagesInMessage;
}
