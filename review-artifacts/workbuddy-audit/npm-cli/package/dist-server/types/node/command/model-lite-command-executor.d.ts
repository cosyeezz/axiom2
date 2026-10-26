import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { NavigationManager } from '../navigation';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
/**
 * 场景变体「lite」的独立命令入口（拆分自 /model 的嵌套 Scenario Models 子流程）。
 * 结构对齐 /model:text-to-image：无参数打开选择面板；"list" 打印可用模型；
 * 传参直接切换。写盘逻辑与 TUI / Host API 共用，不改变既有 lite/reasoning 解析/优先级逻辑。
 */
export declare class ModelLiteCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    private readonly variant;
    protected readonly navigationManager: NavigationManager;
    protected readonly sessionManager: SessionManager;
    execute(ctx: CommandExecuteContext): Promise<void>;
}
