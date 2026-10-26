import { RestOperations } from '@celljs/http';
import { AuthenticationManager } from '@genie/authentication';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { AudioTranscribeResult, AudioTranscribeService, AudioTranscribeSource } from './tool-protocol';
/**
 * 录音文件识别服务实现。
 *
 * 本地文件经后端预签名上传 COS 换取 download_url；调用方给的公网 URL 直接用。
 * 两者都以 `audio_url` 提交异步转写并轮询（从不用 `audio_data`）。
 * 与 VideoServiceImpl 同源的鉴权（run identity 优先、bootstrap 兜底）与会话归因头。
 */
export declare class AudioTranscribeServiceImpl implements AudioTranscribeService {
    protected readonly restOperations: RestOperations;
    protected readonly authenticationManager: AuthenticationManager;
    protected readonly productManager: ProductManager;
    protected readonly logger: Logger;
    transcribe(source: AudioTranscribeSource, context: RunContext<Session>): Promise<AudioTranscribeResult>;
    /**
     * URL 来源直接用；本地文件走预签名 → PUT 上传 → download_url。
     *
     * URL 的可达性与格式由上游判定：下载失败的任务以 `failed` 结束，
     * `error.message`（如 `Failed to download audio file!`）由 pollTask 透传。
     */
    private resolveAudioSource;
    /**
     * 通过后端预签名接口获取 upload/download URL，PUT 文件字节到 COS，返回 download_url。
     *
     * 预签名需服务端持有的 COS secretID/secretKey，本地不得内嵌平台密钥（BL-CLI-12）。
     * COS PUT 走裸 fetch，仅带 Content-Type，绝不把 bearer 或身份头发给 COS（BL-CLI-11）。
     */
    private presignAndUpload;
    /** COS 预签名 PUT：只带 Content-Type（绝不带 bearer/身份头），失败时抛出明确错误。 */
    private putToCos;
    /**
     * 提交转写任务：POST /v2/async/tasks/create，返回 task_id。
     *
     * 识别参数不暴露给 Agent（#128310）：16k 音频只支持单声道，`channel_num` 固定 1；
     * 工具面向会议/访谈等长音频，`speaker_diarization` 默认开启（需 `channel_num=1`）。
     */
    private submitTask;
    /** 轮询任务状态直到 completed / failed / 超时。 */
    private pollTask;
    /**
     * 组装一次 ASR 请求的头。
     *
     * ASR 对 6 个必需 header 缺任意一个（或为空）都返回 400/10001：
     * X-Conversation-ID / X-Conversation-Request-ID / X-Conversation-Message-ID /
     * User-Agent / X-IDE-Type / X-IDE-Name。buildConversationHeaders 可能把
     * X-IDE-Name 置空，这里强制兜底为非空，并补上 buildConversationHeaders 不产出的 User-Agent。
     */
    private buildAsrHeaders;
    /** 生成上传 objectKey：`uploads/{ts}-{rand}-{sanitizedName}`（内联，避免依赖 agent-provider）。 */
    private generateObjectKey;
    /** 准备请求所需的认证与配置（run identity 优先、bootstrap 兜底），与 VideoServiceImpl 同源。 */
    private prepareRequest;
    /** 可中断的 sleep。 */
    private sleep;
}
