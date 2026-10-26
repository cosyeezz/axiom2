import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class ReleaseNotesCommandExecutor implements CommandExecutor {
    private readonly CHANGELOG_PATH;
    private readonly MAX_VERSIONS_TO_SHOW;
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly sessionManager: SessionManager;
    execute(ctx: CommandExecuteContext): Promise<void>;
    /**
     * 提取最近的N个版本记录
     * @param content 完整的 changelog 内容
     * @param maxVersions 要显示的最大版本数
     * @returns 截取后的内容
     */
    private extractRecentVersions;
}
