import { Session } from '../../vendor/cbc-core/node/index.js';
import { Agent, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { AudioTranscribeService, Tool, ToolResult } from './tool-protocol';
/**
 * 只暴露音频文件地址（#128310 §3）。说话人分离、COS 上传、异步转写与结果轮询
 * 全部由工具内部处理，不向 Agent 暴露额外参数。
 */
declare const AudioTranscribeParameters: z.ZodObject<{
    filePath: z.ZodString;
}, "strip", z.ZodTypeAny, {
    filePath: string;
}, {
    filePath: string;
}>;
/**
 * 录音文件识别（长音频转文本）工具。
 *
 * 延迟加载 + 高积分前置审批（与 VideoGen 同机制，见 ModelUtils.isMandatoryApprovalTarget）。
 * 本地音频经后端预签名上传 COS 换取下载地址；调用方给的公网 URL 直接提交，省掉一次上传。
 * 成功返回完整转写文本，失败返回可理解的错误文案（#128310 §7）。
 */
export declare class AudioTranscribeTool extends BaseTool implements Tool {
    protected readonly audioTranscribeService: AudioTranscribeService;
    protected readonly productManager: ProductManager;
    protected readonly logger: Logger;
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{
        filePath: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        filePath: string;
    }, {
        filePath: string;
    }>;
    isEnabled: (_args: {
        runContext: RunContext<Session>;
        agent: Agent;
    }) => Promise<boolean>;
    execute(input: z.infer<typeof AudioTranscribeParameters>, context: RunContext<Session>): Promise<ToolResult>;
    /**
     * 判定 `filePath` 是本地路径还是公网 URL，并做各自的前置校验。
     *
     * `file://` 仍按本地路径处理；其余非 http(s) 的 scheme 要显式报错，否则会掉进
     * 本地分支报 "Audio file not found"，把模型误导去重试路径。
     */
    private resolveSource;
    /**
     * URL 来源：只校验 scheme 与目标不是内网地址。
     *
     * 下载由云端 ASR 发起、本机不连这个地址，所以按字面量判定即可，不做 DNS 解析。
     * 音频格式、时长、可达性同样交给上游：下载失败的任务以 `failed` 结束，
     * `error.message`（如 `Failed to download audio file!`）由 service 透传回来。
     */
    private resolveUrlSource;
    /** 本地来源：校验存在、非目录、大小上限（BL-CLI-01）与扩展名。 */
    private resolveLocalSource;
    /** 归一化本地路径（兼容 file:// 与 Windows 盘符），与 ArtifactTool 同款。 */
    private normalizeLocalPath;
}
export {};
