/**
 * `/fork-bg` —— 把当前会话复制成一个后台会话，**当前会话继续存活**。
 *
 * 对照 Claude Code v2.1.216 的 `/fork`（bundle 554633-554640、781588-781613）。
 * 命名说明：本仓 `/fork` 已经是「前台分支」（与 `/branch` 同一个 executor），
 * 语义与 Claude 相反。为了不改变既有用户的 `/fork` 行为，后台副本另起名 `/fork-bg`。
 *
 * 与 `/background` 的唯一差别就是「原会话是否继续」（design D8）：
 * - `/background`：前台交出去，自己退出
 * - `/fork-bg`：副本进后台，父会话原样留在终端
 */
import { type Session, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { SettingsManager } from '../settings';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class ForkBgCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly sessionManager: SessionManager;
    protected readonly settingsManager: SettingsManager;
    execute(ctx: CommandExecuteContext): Promise<void>;
    /** 透传给副本的启动 flag（对照 D8：权限模式 / 模型 / effort / add-dir / 系统提示词） */
    protected inheritFlags(outputStyle?: string): string[];
    protected restrictedFlag(): string | undefined;
    protected failureMessage(reason: string): string;
    protected isAgentViewDisabled(): Promise<boolean>;
    protected isPersistenceDisabled(): Promise<boolean>;
    protected say(session: Session, text: string): Promise<void>;
}
