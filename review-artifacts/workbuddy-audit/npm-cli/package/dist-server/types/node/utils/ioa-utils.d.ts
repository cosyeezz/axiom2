export interface ApplyIOADefaultHeadersOptions {
    enterpriseId?: string;
    skipDefaultEnterpriseHeaders?: boolean;
}
/**
 * IOA 环境工具类
 * 用于处理 IOA 环境相关的请求头设置
 */
export declare abstract class IOAUtils {
    /**
     * 检查是否为 IOA 环境：设置中的环境变量优先，其次是本次执行的网络环境。
     * @param settingsEnv 设置中的环境变量
     * @returns 是否为 IOA 环境
     */
    static isIOAEnvironment(settingsEnv?: Record<string, string>): boolean;
    /**
     * 为 IOA 环境设置默认请求头。
     * iOA 个人账号可通过 skipDefaultEnterpriseHeaders 保留 X-Domain，避免补默认企业身份。
     *
     * @param headers 要修改的请求头对象
     * @param settingsEnv 设置中的环境变量
     * @param options 默认企业头控制选项
     */
    static applyIOADefaultHeaders(headers: Record<string, string>, settingsEnv?: Record<string, string>, options?: ApplyIOADefaultHeadersOptions): Promise<void>;
}
