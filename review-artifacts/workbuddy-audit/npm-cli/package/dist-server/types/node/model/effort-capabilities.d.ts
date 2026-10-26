import type { LanguageModel, ReasoningEffortLevel, ThinkingLevelMap } from '@genie/product';
/**
 * CLI 模式 effort 档位与模型能力联动（Issue #87437）。
 *
 * 背景：`/effort` 与 EffortPanel 此前固定展示 5+1 档，不校验当前模型是否支持，
 * 用户对不支持的模型选 `max` 后（尤其内部 LLM host 链路跳过出网 compat 层）会触发上游 400。
 * 这里提供档位能力解析 / clamp / 过滤的纯函数，供 `/effort` 命令、EffortPanel、
 * 发送侧 interceptor 共用，语义对齐 UI 侧 `clampEffortToSupported`
 * （`packages/agent-ui/src/components/main-content-core/hooks/use-model-selector.ts`）。
 *
 * 档位能力来源优先级：
 *   1. `LanguageModel.reasoning.supportedEfforts`（product config / Unleash 下发，精确集合）
 *   2. `LanguageModel.thinkingLevelMap` 推导最高可达档位（catalog 提供的翻译表启发）
 *   3. 都没有 → undefined（不限制，保持现状）
 */
/** 共享契约全 6 档的顺序，用于"≤ 原值"的 clamp 语义（与 UI 侧 EFFORT_ORDER 一致）。 */
export declare const EFFORT_ORDER: readonly ReasoningEffortLevel[];
/** CLI `/effort` 当前暴露的档位基座（不含 minimal；ultracode 由命令/面板单独处理）。 */
export declare const CLI_EFFORT_LEVELS: readonly ReasoningEffortLevel[];
/**
 * 从 thinkingLevelMap 推导模型可达的最高档位。
 *
 * 这是 CLI 展示 / clamp 用的启发式上限，不等价于出网 compat 层的逐档翻译：
 *   - map 含 `max`（非 null）→ 上限 max
 *   - map 含 `xhigh`（非 null）→ 上限 xhigh
 *   - 其它（含 map 缺失 / `xhigh: null`）→ 上限 high
 */
export declare function deriveMaxEffortFromMap(map: ThinkingLevelMap | undefined): ReasoningEffortLevel;
/**
 * 解析模型支持的档位集合。
 *
 * - `supportedEfforts` 存在 → 直接返回（精确集合；空数组也代表无可选多档）
 * - 缺失 → 用 thinkingLevelMap 推导：按 `deriveMaxEffortFromMap` 得到的上限截断 EFFORT_ORDER
 * - 都缺失（catalog 未建模 / 白名单 miss 的裸 `{id,name}` 模型）→ undefined（不限制）
 */
export declare function resolveSupportedEfforts(model: Pick<LanguageModel, 'reasoning' | 'thinkingLevelMap'> | undefined): ReasoningEffortLevel[] | undefined;
/**
 * 发送侧（写模型请求前）用的能力集合。
 *
 * 与 `resolveSupportedEfforts` 的唯一差异：`supportedEfforts` 为空数组时不视为
 * "无可达档位"（那会让 clamp 无从下手），而是退回 thinkingLevelMap 推导。
 * 优先级仍是显式集合 > thinkingLevelMap，避免同一模型在命令/面板被拒的档位在
 * 发送侧被放行。
 */
export declare function resolveRequestEffortCapability(model: Pick<LanguageModel, 'reasoning' | 'thinkingLevelMap'> | undefined): ReasoningEffortLevel[] | undefined;
/**
 * 把 effort clamp 到模型支持集合内（对齐 UI 侧 clampEffortToSupported）：
 *   - 无 effort → undefined
 *   - supported 为空/未声明 → 原样返回（不限制）
 *   - effort 在集合内 → 原样
 *   - 否则 → 集合中 ≤ effort 的最高档；所有支持档都比 effort 高 → 取最低档
 */
export declare function clampEffortToSupported(effort: ReasoningEffortLevel | undefined, supported: ReadonlyArray<ReasoningEffortLevel> | undefined): ReasoningEffortLevel | undefined;
/**
 * 基于模型支持集合过滤候选档位列表（保持 levels 原有顺序）。
 * supported 未声明时原样返回，显式空数组时返回空列表。
 */
export declare function filterEffortLevels<Level extends ReasoningEffortLevel>(levels: readonly Level[], supported: ReadonlyArray<ReasoningEffortLevel> | undefined): Level[];
/**
 * UI picker 专用过滤：能力未知时不按全量展示，改用安全档位（排除 max）。
 * picker 不展示未知能力模型的 max；手输 `/effort max` 仍由命令/发送侧兜底，
 * 真实支持 max 的自定义模型需在模型配置里声明能力。
 */
export declare function filterEffortLevelsForPicker<Level extends ReasoningEffortLevel>(levels: readonly Level[], supported: ReadonlyArray<ReasoningEffortLevel> | undefined): Level[];
