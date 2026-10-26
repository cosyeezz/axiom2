export declare abstract class TimeUtils {
    /**
     * 格式化时间戳为可读的时间字符串
     */
    static format(timestamp: number): string;
    /**
     * 把一个回合的耗时（毫秒）格式化成 `✔ Worked for …` 里展示的形态。
     *
     * 与 `format` 的区别：这里取整秒、不带小数，对齐 codex 的
     * `fmt_elapsed_compact`。`format` 保留一位小数且已有多处调用方依赖，
     * 不能就地改。
     *
     * 规则：`45s` / `1m 23s` / `1h 01m 05s`。下界抬到 `1s`——极快的回合
     * 显示 `0s` 看着像出错；这个下界与 goal 的 `formatGoalStats` 一致。
     *
     * 用 `floor` 而不是 `round`：等待期间输入框上方那个计时器是向上数的秒表，
     * 也取 floor（见 loading-box 的 SecondsTimer）。若这里改用 round，6.6 秒的
     * 回合会在计时器停在 6s 之后显示成 `7s`，看起来像凭空多了一秒——这两处并排
     * 出现在同一屏上，必须同口径。
     *
     * 注意**只有下界**与 `formatGoalStats` 对齐，取整方式没有：后者仍用 `round`
     * （`goal/goal-format.ts`，Web UI 侧 `GoalRecapModal.tsx` 另有一份拷贝）。
     * goal 的数字不与实时秒表并排展示，没有同样的对齐压力，故未一并改动。
     */
    static formatTurnDuration(durationMs: number): string;
    /**
     * 将“过去的时间差（毫秒）”格式化为英文相对时间，返回最接近的单一单位 + ' ago'
     */
    static formatAgo(timestamp: number): string;
    /**
     * 将“过去的时间差（毫秒）”格式化为英文相对时间，返回最接近的单一单位 + ' ago'
     */
    static formatDuration(duration: number): string;
}
