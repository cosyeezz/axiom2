import type { AgentInputItem } from '../../../cbc-shared/node/index.js';
/**
 * 给「孤立 reasoning」补一条空 assistant 承载项，否则这一轮的思考会在序列化时被丢掉
 * （#119765）。
 *
 * `@openai/agents-openai` 的 patch 把 reasoning 改成「先挂起、等下一条 assistant /
 * function_call / hosted_tool_call 再附上去」。零正文截断的历史是
 * `[reasoning, user(续写提示)]`，思考永远 flush 不掉。
 *
 * 本函数只改本次请求的 input 拷贝，不写历史——思考 item 本身已经持久化，
 * 下一轮 filter 会按同样形状再补一次。
 *
 * **每条**缺落点的 reasoning 都要各补一个，不能只补最后一条：挂起槽是单个变量，
 * 后一条 reasoning 会直接覆盖前一条（`pendingReasoning = ...`）。一条 3 次的恢复链上
 * 只补最后一条时，前两轮的思考会静默丢失——线上实测表现为连续几条 meta user message
 * 之间一条思考都没有，模型只能反复重新审题。
 *
 * 尾部恰是 reasoning 时不补（keep-alive 空续圈，已有
 * `appendContinuationStubIfAssistantTrailing` 兜底，两处都改尾部会叠加）。
 *
 * @remarks 原地修改 `input`（`splice` 插入承载项），不返回新数组。与邻居
 * `appendContinuationStubIfAssistantTrailing` 的 `push` 惯例一致；调用方传入的是
 * SDK 每轮重建的请求级数组，不是共享历史。不改名（如 `…InPlace`）是为避免跨包
 * 符号抖动，副作用以本备注为准。`Array.isArray` 守卫对 TS 签名是死分支，保留是为了
 * 防御 JS/序列化侧误传非数组。
 *
 * @returns 插入的承载项数量
 */
export declare function attachOrphanedReasoningCarriers(input: AgentInputItem[]): number;
/**
 * 承载项**不能**带 `providerData`：转换器的 assistant 分支会把它整体展开成 wire 字段
 * （`{ role, content, tool_calls, ...providerData }`），任何内部标记都会变成协议字段
 * 发给网关。实测打上 `{ orphanedReasoningCarrier: true }` 后，请求体里真的多出
 * `"orphanedReasoningCarrier": true` 与 `role` 平级。
 *
 * 识别承载项一律按形状判定（assistant + content 为空 + 带非空 reasoning），
 * 下游 `sanitizeEmptyContent` 用的就是这个判据，不依赖任何标记。
 */
export declare function createOrphanedReasoningCarrier(): AgentInputItem;
//# sourceMappingURL=orphaned-reasoning-carrier.d.ts.map