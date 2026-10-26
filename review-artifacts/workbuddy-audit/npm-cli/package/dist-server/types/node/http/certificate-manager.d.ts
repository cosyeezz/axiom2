import { Logger } from '@celljs/core';
export interface RefreshOsCertificatesResult {
    changed: boolean;
}
export declare class CertificateManager {
    private static readonly CERT_REGEX;
    private readonly customCAPath;
    private cachedCertificates;
    protected logger: Logger;
    /**
     * 从 PEM 文件读取证书
     */
    protected readCertificatesFromFile(filePath: string, source: string): string[];
    /**
     * 获取自定义CA证书
     */
    protected getCustomCACertificates(): string[];
    /**
     * 获取完整的CA证书包（系统证书 + 自定义证书）
     */
    getCABundle(): string[];
    /**
     * 从 OS 证书库 dump 一次并并入当前进程信任根（只增不重建）。
     *
     * dump + 冷却由 {@link runTlsCaRefresh} 负责。没变化则不改默认信任库。
     * `ca` 选项会整表替换默认根，因此 bundle 仍是 Mozilla + extra。
     * 若存在 `tls.setDefaultCACertificates`，同步写进程默认信任库，
     * 让 undici / fetch / OTLP 与 axios 看到同一份根。
     *
     * `options.force` 透传给 {@link runTlsCaRefresh}：用户主动发消息的
     * chat 请求置 true，绕过常规 20s 冷却（#127262 装根后冷却窗口内
     * 重发自愈）；默认 false，后台请求行为不变。
     */
    refreshFromOperatingSystem(options?: {
        force?: boolean;
    }): Promise<RefreshOsCertificatesResult>;
    /**
     * 清除证书缓存（用于热重载）
     */
    clearCache(): void;
    private applyDefaultCACertificates;
    /**
     * 验证证书文件格式
     */
    validateCertificateFile(filePath: string): {
        valid: boolean;
        error?: string;
        count?: number;
    };
}
