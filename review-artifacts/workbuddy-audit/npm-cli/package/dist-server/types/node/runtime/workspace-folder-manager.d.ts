import { Session, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { SettingsManager, SettingsScope } from '../settings';
export declare const WorkspaceFolderManager: unique symbol;
/**
 * 工作目录的落点：
 * - 'session'：仅当前会话生效，存 session.options.addDir，不落盘
 * - SettingsScope：持久化到对应的配置文件（user / project / project-local）
 */
type WorkspaceFolderTarget = 'session' | SettingsScope;
export interface WorkspaceFolderManager {
    /**
     * 添加工作目录
     */
    addWorkspaceFolder(directory: string, target: WorkspaceFolderTarget): Promise<void>;
    /**
     * 移除工作目录
     */
    removeWorkspaceFolder(directory: string, target: WorkspaceFolderTarget): Promise<void>;
    /**
     * 从所有落点（session + 所有持久化 scope）移除工作目录
     */
    removeWorkspaceFolderEverywhere(directory: string): Promise<void>;
    /**
     * 获取所有工作目录
     */
    getWorkspaceFolders(target?: WorkspaceFolderTarget): Promise<string[]>;
    /**
     * 判断是否包含工作目录
     */
    hasWorkspaceFolder(directory: string, target: WorkspaceFolderTarget): Promise<boolean>;
}
export declare class WorkspaceFolderManagerImpl implements WorkspaceFolderManager {
    protected readonly sessionManager: SessionManager;
    protected readonly settingsManager: SettingsManager;
    protected currentSession: Session | undefined;
    protected init(): void;
    private getScopeDirectories;
    private operateWorkspaceFolder;
    addWorkspaceFolder(directory: string, target: WorkspaceFolderTarget): Promise<void>;
    removeWorkspaceFolder(directory: string, target: WorkspaceFolderTarget): Promise<void>;
    removeWorkspaceFolderEverywhere(directory: string): Promise<void>;
    getWorkspaceFolders(target?: WorkspaceFolderTarget): Promise<string[]>;
    hasWorkspaceFolder(directory: string, target: WorkspaceFolderTarget): Promise<boolean>;
}
export {};
