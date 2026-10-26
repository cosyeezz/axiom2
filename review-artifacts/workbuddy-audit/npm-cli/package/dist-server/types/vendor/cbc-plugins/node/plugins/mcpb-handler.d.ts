import { McpConfig } from '../../../../node/mcp/index.js';
import { McpBundleEntry, McpBundleLoadResult } from './plugin-protocol';
/**
 * 判断源字符串是否为 MCPB 文件引用
 */
export declare function isMcpbSource(source: string): boolean;
/**
 * 加载 MCP Bundle 文件
 *
 * 流程：
 * 1. 检查缓存
 * 2. 下载或读取本地文件
 * 3. 校验 checksum
 * 4. 解压 ZIP
 * 5. 解析 manifest.json
 * 6. 生成 MCP 服务器配置
 * 7. 保存缓存元数据
 */
export declare function loadMcpBundle(bundle: McpBundleEntry, pluginPath: string, pluginId: string, onProgress?: (status: string) => void): Promise<McpBundleLoadResult>;
/**
 * 批量加载 MCP Bundles
 */
export declare function loadMcpBundles(bundles: McpBundleEntry[], pluginPath: string, pluginId: string, onProgress?: (status: string) => void): Promise<{
    configs: Record<string, McpConfig>;
    errors: Array<{
        bundle: McpBundleEntry;
        error: Error;
    }>;
}>;
//# sourceMappingURL=mcpb-handler.d.ts.map