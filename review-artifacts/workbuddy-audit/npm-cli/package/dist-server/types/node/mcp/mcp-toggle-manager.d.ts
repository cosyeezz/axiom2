import { Subject } from 'rxjs';
import { McpConfigStore, McpServerModelManager, McpToggleManager } from './mcp-protocol';
export declare class McpToggleManagerImpl implements McpToggleManager {
    protected readonly mcpServerModelManager: McpServerModelManager;
    protected readonly mcpConfigStore: McpConfigStore;
    toggleSubject: Subject<{
        serverName: string;
        disabled: boolean;
    }>;
    /**
     * 内存中缓存的禁用状态（用于非持久化作用域: INTERNAL/SDK/DYNAMIC）
     *
     * PLUGIN 作用域不再走这里——它的禁用状态会持久化到 LOCAL 配置（per-cwd），
     * 详见 updateDisabledState / isDisabled。
     */
    private inMemoryDisabled;
    disable(serverNames: string | string[]): Promise<void>;
    enable(serverNames: string | string[]): Promise<void>;
    isDisabled(serverName: string): boolean;
    /**
     * 更新服务器的禁用状态
     * - 对于 PROJECT 作用域: 更新到 PROJECT 配置文件
     * - 对于 USER/LOCAL/PLUGIN 作用域: 更新到 LOCAL 配置文件
     * - 对于 INTERNAL/SDK/DYNAMIC 作用域: 更新到内存缓存（这些 scope 本身不持久化，
     *   每次启动由内置 / IDE / --mcp-config 重新注入，内存策略合理）
     */
    private updateDisabledState;
    /**
     * 更新指定作用域的禁用状态
     *
     * 使用 mcpConfigStore.update() 确保：
     * - LOCAL 作用域正确更新到 projects[cwd] 下
     * - PROJECT 作用域正确更新文件根字段
     * - 保留所有现有配置数据
     *
     * @param scope 只允许 PROJECT 或 LOCAL 作用域（可持久化的作用域）
     * @param serverName 服务器名称
     * @param disabled 是否禁用
     */
    private updateScopeDisabledState;
    /**
     * 读取指定作用域的配置数据
     */
    private readScopeData;
}
