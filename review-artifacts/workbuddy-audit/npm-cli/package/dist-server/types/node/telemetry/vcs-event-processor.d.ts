import { EventProcessContext, EventProcessor } from '@genie/telemetry';
/**
 * CLI 环境下的 VCS 事件处理器
 * 基于工程根目录，通过读取 .git 文件系统获取 Git 信息
 */
export declare class VCSEventProcessor implements EventProcessor {
    private cache?;
    private readonly cacheTTL;
    process({ event }: EventProcessContext): Promise<void>;
    private getVcsInfo;
    /**
     * 读取 HEAD 引用，解析出完整 commit SHA
     */
    private getRevisionId;
    /**
     * 清除 Git URL 中的敏感信息（用户名/密码）
     */
    private clearSensitiveData;
}
