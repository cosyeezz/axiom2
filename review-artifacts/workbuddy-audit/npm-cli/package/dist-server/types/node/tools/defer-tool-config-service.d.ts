import { ProductManager } from '@genie/product';
import { McpConfig } from '../mcp/mcp-protocol';
import { SettingsManager } from '../settings/settings-protocol';
import { DeferToolConfigService } from './defer-tool-config-protocol';
import { ToolDeferOverlay } from './tool-spec';
export declare class DeferToolConfigServiceImpl implements DeferToolConfigService {
    protected readonly settingsManager: SettingsManager;
    protected readonly productManager: ProductManager;
    isGlobalDeferLoadingEnabled(): Promise<boolean>;
    shouldShowAllTools(): boolean;
    isToolDeferLoading(config: McpConfig, ...toolNames: string[]): Promise<boolean>;
    isToolDeferLoadingWithOverlay(overlay: ToolDeferOverlay | undefined, config: McpConfig, ...toolNames: string[]): Promise<boolean>;
    isBuiltinToolDeferLoading(toolName: string, productDefault: boolean, overlay: ToolDeferOverlay | undefined): boolean;
    /**
     * Parse environment variable as boolean.
     * Supports: true/false/1/0 (case-insensitive)
     */
    private parseEnvBoolean;
    /**
     * Get defer tool loading config from product.json productFeatures
     */
    private getProductConfig;
}
