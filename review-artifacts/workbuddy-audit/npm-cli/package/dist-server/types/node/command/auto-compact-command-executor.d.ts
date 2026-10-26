import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { SettingsManager } from '../settings';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
/**
 * `/autocompact <auto | 400k | 1m | 400000>` —— 设置自动压缩窗口大小，写入 user settings
 * 的 `autoCompactWindow`（对齐 Claude Code 的 `/autocompact`）。
 *
 * - `auto`：清空 `autoCompactWindow`，回到「跟随模型窗口」
 * - token 数（支持 1000 进制 k/m 后缀）：写入 clamp 到 [100k, 1M] 后的值
 * - 无参数：显示当前生效值
 */
export declare class AutoCompactCommandExecutor implements CommandExecutor {
    name: string;
    autoGenerateHistory: boolean;
    protected readonly sessionManager: SessionManager;
    protected readonly settingsManager: SettingsManager;
    execute(ctx: CommandExecuteContext): Promise<void>;
    private describeCurrent;
    private output;
}
