import { Subject } from 'rxjs';
export declare const VimManager: unique symbol;
export interface VimManager {
    /**
     * 检查 Vim 模式是否启用
     */
    isEnabled(): Promise<boolean>;
    /**
     * 启用 Vim 模式
     */
    enable(): Promise<void>;
    /**
     * 禁用 Vim 模式
     */
    disable(): Promise<void>;
    /**
     * 切换 Vim 模式状态
     */
    toggle(): Promise<boolean>;
    /**
     * Vim 状态变化的 Subject
     */
    readonly onDidChangeState: Subject<boolean>;
}
