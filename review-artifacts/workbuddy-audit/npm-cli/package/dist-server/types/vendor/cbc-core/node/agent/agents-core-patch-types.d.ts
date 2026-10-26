/**
 * `@openai/agents-core` patch 的类型面（#105631）。
 *
 * 运行时能力在 `patches/@openai+agents-core+0.5.2.patch`；类型声明放这里而不是改
 * `node_modules` 里的 `.d.ts` —— 那儿每次 install 重新生成、不进 code review。
 * 完整理由与升级步骤见 `patches/PATCHES.md`（K1）。
 */
import type { AgentInputItem, RunConfig, RunContext } from '../../../cbc-shared/node/index.js';
/** patch 在每个 model step 的 `prepareTurn` 之前调用它，把返回项写入权威 RunState。 */
export type ContinuationInputProvider = (args: {
    runContext: RunContext<unknown>;
}) => Promise<AgentInputItem[]>;
/** patch 之后 `Runner` 构造参数可接受的额外字段。 */
export type PatchedRunConfig = Partial<RunConfig> & {
    continuationInputProvider?: ContinuationInputProvider;
};
/** patch 之后 `Runner` 实例上可读到的额外配置（用于装配后自检）。 */
export interface PatchedRunnerConfig {
    readonly continuationInputProvider?: ContinuationInputProvider;
}
/** patch 未生效时 Runner 会静默丢弃扩展点 → steer 丢失且空续圈烧到 maxTurns，这里改成立即报错。 */
export declare function assertContinuationInputProviderApplied(runner: {
    config: PatchedRunnerConfig;
}): void;
//# sourceMappingURL=agents-core-patch-types.d.ts.map