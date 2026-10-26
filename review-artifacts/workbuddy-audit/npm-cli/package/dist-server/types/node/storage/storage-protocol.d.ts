/**
 * Storage Service Protocol
 *
 * 提供 UI 组件状态的后端持久化能力。
 * 参考 VSCode IStorageService 设计，简化为两级作用域。
 *
 * 存储位置（均在用户目录下，不在项目目录内）：
 *   - GLOBAL:    ~/.codebuddy/storage.json
 *   - WORKSPACE: ~/.codebuddy/projects/{project-hash}/storage.json
 *
 * 数据格式：扁平 key-value，key 使用 namespace.property 点分格式。
 */
export declare enum StorageScope {
    /** 全局用户级 — ~/.codebuddy/storage.json */
    GLOBAL = "global",
    /** 项目级 — ~/.codebuddy/projects/{project-hash}/storage.json */
    WORKSPACE = "workspace"
}
export declare const StorageService: unique symbol;
/**
 * Storage 操作的可选参数。
 * folder 用于 workspace scope 的子隔离（类似 VSCode 的 workspaceStorage/{workspace-id}）。
 */
export interface StorageOptions {
    scope?: StorageScope;
    /**
     * 当 scope=workspace 时，指定 folder 路径可将存储隔离到
     * ~/.codebuddy/projects/{compressPath(folder)}/storage.json。
     * 不传则使用 agent 启动时的 cwd 对应的目录。
     */
    folder?: string;
}
export interface StorageService {
    /**
     * 获取单个值。
     * key 使用 namespace.property 格式，如 "theme.mode"。
     */
    get(key: string, scope?: StorageScope, folder?: string): Promise<unknown>;
    /**
     * 获取一个命名空间下的所有值。
     * 如 getNamespace("terminal") 返回 { layout: ..., panes: ... }。
     */
    getNamespace(namespace: string, scope?: StorageScope, folder?: string): Promise<Record<string, unknown>>;
    /**
     * 设置单个值。
     */
    set(key: string, value: unknown, scope?: StorageScope, folder?: string): Promise<void>;
    /**
     * 批量设置多个值（原子操作）。
     */
    setMany(entries: Array<{
        key: string;
        value: unknown;
    }>, scope?: StorageScope, folder?: string): Promise<void>;
    /**
     * 删除单个值。
     */
    remove(key: string, scope?: StorageScope, folder?: string): Promise<void>;
    /**
     * 列出指定 scope 的所有键值对。
     */
    list(scope?: StorageScope, folder?: string): Promise<Record<string, unknown>>;
}
export declare const STORAGE_FILENAME = "storage.json";
