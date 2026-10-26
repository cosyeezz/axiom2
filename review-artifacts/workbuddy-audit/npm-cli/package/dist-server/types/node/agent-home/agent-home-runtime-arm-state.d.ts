/**
 * Agent Home 运行时 arm 标志（**叶子模块，不 import 任何东西**）。
 *
 * 为什么要单独一个文件：`isAgentHomeRuntimeArmed()` 要被 **同步**判据用
 * （`isAgentHomeJobBlockingAgentTeams` / `agentHomeToolSearchVisibility`），
 * 而那些判据住在 agent-home-runtime / agent-home-tool-gate；arm 逻辑又要 import 它们
 * 的 `isAgentHomeFeatureEnabled`。把标志抽成叶子，两边都只依赖它，避免 import 成环。
 */
/** 运行时是否已 arm（同步可读）。 */
export declare function isAgentHomeRuntimeArmed(): boolean;
/** 置位（返回是否是本次置上的：false = 之前已 arm，幂等）。 */
export declare function markAgentHomeRuntimeArmed(): boolean;
/** 测试用：复位。 */
export declare function __resetAgentHomeRuntimeArmedForTests(): void;
