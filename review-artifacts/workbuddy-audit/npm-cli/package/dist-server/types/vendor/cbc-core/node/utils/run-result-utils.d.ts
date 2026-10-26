import type { RunResult, StreamedRunResult } from '../../../cbc-shared/node/index.js';
export declare abstract class RunResultUtils {
    static isStream(result: RunResult<any, any> | StreamedRunResult<any, any>): result is StreamedRunResult<any, any>;
    /**
     * 判断是否为 final output 状态
     * @param result - 运行结果
     * @returns 如果不是流式对象返回 true；如果是流式对象，则判断当前步骤类型是否为 'next_step_final_output'
     */
    static isFinalOutput(result: RunResult<any, any> | StreamedRunResult<any, any>): boolean;
    /**
     * 从运行结果中提取最终输出。
     *
     * 必须先用 {@link isFinalOutput} 守卫：run 未走到 `next_step_final_output`
     * 步骤时（例如被 ESC 中断 abort），SDK 的 `RunResultBase.finalOutput`
     * getter 会 `console.warn('Accessed finalOutput before agent run is completed.')`。
     * 非 final 状态直接返回 undefined，绝不触碰 `.finalOutput` getter；
     * 调用方（如 extractLastAssistantMessage）本就会回退到 session.history。
     *
     * @param result - 运行结果
     * @returns 最终输出值，或 undefined
     */
    static extractFinalOutput(result: RunResult<any, any> | StreamedRunResult<any, any>): unknown;
}
//# sourceMappingURL=run-result-utils.d.ts.map