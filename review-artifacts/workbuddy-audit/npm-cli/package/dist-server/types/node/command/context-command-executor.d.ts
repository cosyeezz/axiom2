import { CommandExecuteContext, CommandExecutor } from './command-protocol';
/**
 * /context 命令执行器
 * 计算当前会话的上下文token分布情况
 */
export declare class ContextCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    execute(ctx: CommandExecuteContext): Promise<void>;
    /**
     * 格式化输出。布局对齐 Claude `/context`：
     * 分类标题带估算合计（"Estimated usage by category · 33.7k"），与顶行
     * `realInputTokens` 分开，避免把分项加总误当成上次请求的权威用量。
     * Skills 单独成行（从 System tools 里划出，避免重复计数）；
     * Memory / Skills / Agents 默认折叠，`/context all` 展开。
     *
     * 顶行 / 矩阵 / Free space 优先 `realInputTokens`，无真实调用时回退 `total`。
     * 分项行始终是本地粗估；`/context` 本身写入历史后 Messages 会涨，顶行要等下次模型请求才更新。
     */
    private formatOutput;
    private isExpandArg;
    private formatCollapsedOrExpandedDetails;
    /**
     * 按 scope 分组 skills 和 commands
     */
    private groupSkillsAndCommandsByScope;
    /**
     * 合并矩阵和明细信息，并排显示
     */
    private mergeMatrixAndDetails;
    /**
     * 创建彩色矩阵显示
     * @param usedTokens 权威用量（顶行同源）。矩阵填充总量由它决定，各分项只决定
     *   这些格子的配色比例，避免"顶行 85%而格子只填 23%"的矛盾（#69538）。
     */
    private createMatrix;
    /**
     * 格式化token数量显示
     */
    private formatTokens;
}
