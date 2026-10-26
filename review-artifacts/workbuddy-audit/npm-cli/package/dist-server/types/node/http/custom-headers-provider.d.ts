import { ProductManager } from '@genie/product';
import { SettingsManager } from '../settings';
/**
 * 解析并注入 CODEBUDDY_CUSTOM_HEADERS。
 *
 * 仅对平台 endpoint 的出站请求写入；第三方 URL（COS、MCP、WebFetch 直连兜底等）不注入。
 * 写入规则：目标 header 缺失才写，且跳过认证 / hop-by-hop / 请求唯一 ID 黑名单。
 */
export declare class CustomHeadersProvider {
    protected readonly settingsManager: SettingsManager;
    protected readonly productManager: ProductManager;
    /**
     * 解析 `Name: Value` 列表。字面量 `\n` 优先于真实换行符。
     * 无冒号或 key/value 为空的行丢弃。
     */
    static parseCustomHeaders(customHeadersString?: string): Record<string, string>;
    protected getEnvironment(): NodeJS.ProcessEnv;
    resolve(): Promise<Record<string, string>>;
    isPlatformUrl(url: string): boolean;
    /**
     * 就地写入自定义 header。
     * 传了 `url` 时先做平台 origin 判定；工具调用点已知打的是平台接口，可省略。
     */
    applyTo(headers: Record<string, string>, url?: string): Promise<void>;
    private collectPlatformOrigins;
}
