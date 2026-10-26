import { ParsedToolSpecs } from './tool-spec-protocol';
/**
 * 当用户在「工具列表」字段里写了至少一条 `Defer(...)`，自动把 `ToolSearch` /
 * `DeferExecuteTool` 补进 names（已存在则跳过）。
 *
 * 同时给这两个工具加 `forceNoDefer` 护栏：
 *   用户可能写 `Defer(*)` 把所有工具一刀切收进延迟加载，没有护栏的话两个 defer
 *   工作流工具自身也会被 defer 掉，模型连搜索能力都失去——`Defer(*)` 就完全失效了。
 *   `forceNoDefer` 永远胜过 `forceDefer`，所以两个工具能稳定保留在 LLM 工具列表里。
 *
 * `NoDefer(...)` 不触发自动附加：它的语义是把工具拉回直接调用，跟 defer 工作流无关。
 *
 * 幂等：names 里已有的工具不重复添加；overlay forceNoDefer 同理用 Set 去重。
 *
 * 入参 `parsed` *不* 被修改，返回新对象。
 */
export declare function augmentParsedSpecsForDefer(parsed: ParsedToolSpecs): ParsedToolSpecs;
