/**
 * 工具调用循环的模式识别，与 DI / session / 埋点完全解耦，便于单测穷举边界。
 *
 * 这里只负责「看一串工具名，判断是否构成循环」，不关心弹窗、退费和宿主门控。
 */
import type { ToolCallLoopTriggerType } from '@genie/telemetry/lib/common/event/types/craft';
export interface ToolCallLoopThresholds {
    /** 同一工具连续调用达到该次数即判定为循环。Bash / Write 走单独阈值。 */
    consecutiveThreshold: number;
    /**
     * Bash 与 Write 连续调用的单独阈值。长任务里模型会连续跑很多条命令、
     * 或连续落很多个文件，只看工具名时 40 次容易把正常推进误判成循环。
     */
    bashConsecutiveThreshold: number;
    /** AAB 块需要连续重复的轮数。 */
    sequenceRepeats: number;
}
export interface ToolCallLoopHit {
    triggerType: ToolCallLoopTriggerType;
    /** 触发时命中的次数：连续同工具为调用次数，重复序列为重复轮数。 */
    occurrences: number;
    /** 重复序列的周期长度；AAB 恒为 3，连续同工具恒为 1。 */
    patternLength: number;
}
/** 与 `ToolNames.BASH` / `ToolNames.WRITE` 对齐。模式识别层不依赖 agent-protocol，避免把工具名枚举拉进来。 */
export declare const BASH_LOOP_TOOL_NAME = "Bash";
export declare const WRITE_LOOP_TOOL_NAME = "Write";
export declare const DEFAULT_TOOL_CALL_LOOP_THRESHOLDS: ToolCallLoopThresholds;
/** AAB 块的长度。多工具循环只识别这一种形状，因此是常量而非可配阈值。 */
export declare const AAB_PERIOD = 3;
/**
 * 单次请求内的工具调用轨迹。
 *
 * `consecutiveCount` 与 `history` 是两套独立口径：前者服务「连续同工具」规则，
 * 后者服务「AAB 重复」规则，二者互不干扰，因此同一串调用可能先命中任意一条。
 */
export declare class ToolCallLoopTracker {
    private readonly thresholds;
    private consecutiveTool;
    private consecutiveCount;
    private history;
    constructor(thresholds: ToolCallLoopThresholds);
    /**
     * 记录一次即将执行的工具调用，返回本次是否命中循环。
     *
     * 命中优先级：先判连续同工具，再判 AAB 重复。两条规则的阈值默认不重叠
     * （普通工具 40 次、Bash / Write 80 次 vs AAB 重复 10 轮），实践中不会互相抢占。
     */
    record(toolName: string): ToolCallLoopHit | undefined;
    /**
     * 用户选择继续执行后清零，让同一请求可以在下一轮阈值时再次提醒，
     * 而不是刚点完继续就被同一段历史立刻二次拦住。
     */
    reset(): void;
}
/**
 * 判断调用轨迹尾部是否为「AAB 块连续重复 repeats 轮」。
 *
 * 多工具循环只认严格的 `[X, X, Y]`（`X ≠ Y`）这一种形状，其余形态刻意放过：
 * - `ABC`（三者互不相同）通常是正常的多步工作流（读文件 → 改文件 → 跑测试，
 *   然后换下一个文件），按周期重复判它循环误伤面太大；
 * - `ABAB` 这类两工具交替同样不判，避免把翻页 / 分批处理误当循环；
 * - `AAA…` 属于连续同工具，由 consecutiveThreshold / bashConsecutiveThreshold（Bash、Write）那条规则负责。
 *
 * `X ≠ Y` 顺带保证了 AAB 一定是本原周期（唯一可能的更短整除周期是 1，
 * 那要求三个元素全等），所以不需要额外的本原性校验。
 */
export declare function matchesRepeatedAabSequence(history: readonly string[], repeats: number): boolean;
/**
 * 读取阈值配置。环境变量只用于 QA 快速复现，生产不设置即走默认值。
 * AAB 的周期是形状定义的一部分，不开放配置。
 *
 * `CBC_LOOP_GUARD_CONSECUTIVE_THRESHOLD` 只覆盖非 Bash / Write 工具。Bash 与 Write
 * 共用 `CBC_LOOP_GUARD_BASH_CONSECUTIVE_THRESHOLD`，避免 QA 把通用阈值压低时
 * 把长任务放宽一并关掉。
 */
export declare function resolveToolCallLoopThresholds(env?: NodeJS.ProcessEnv): ToolCallLoopThresholds;
//# sourceMappingURL=tool-call-loop-pattern.d.ts.map