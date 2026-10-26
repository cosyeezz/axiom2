/**
 * `/background`（别名 `/bg`）—— 把当前会话搬到后台，前台退出。
 *
 * 对照 Claude Code v2.1.216 bundle 559597-559606 / 768141-768163：
 * - 已经是后台会话 → 等价 detach，不新建
 * - 持久化关闭 → 拒绝
 * - 一条消息都还没有 → `Nothing to background yet — send a message first.`
 * - 成功 → spawn 后打印后续命令提示
 */
import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { type Session } from '../../vendor/cbc-core/node/index.js';
import { SettingsManager } from '../settings';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class BackgroundCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly sessionManager: SessionManager;
    protected readonly settingsManager: SettingsManager;
    execute(ctx: CommandExecuteContext): Promise<void>;
    protected failureMessage(reason: string): string;
    protected isAgentViewDisabled(): Promise<boolean>;
    protected isPersistenceDisabled(): Promise<boolean>;
    protected say(session: Session, text: string): Promise<void>;
}
/** `/bg` —— `/background` 的别名（对照 Claude `aliases: ["bg"]`） */
export declare class BgCommandExecutor extends BackgroundCommandExecutor {
    name: string;
}
