import { Logger } from '@genie/telemetry';
import { z } from 'zod';
/**
 * Coerce the SDK's parsed input to a plain object usable as DeferExecuteTool's `params`.
 * The SDK parses tool arguments through the schema, so `input` is usually an object.
 * Guard against string/undefined edge cases.
 *
 * 关键：部分模型 / streaming 路径会把 arguments 以 JSON **字符串**交给
 * `parameters.parse()`。若 schema 是裸 `z.object(...)`，会在 invoke 之前就抛
 * `Expected object, received string`，直调 deferred MCP 工具失败；模型再走
 * DeferExecuteTool 重试。对非幂等工具（如 ardot create_design）会叠加 Host
 * bootstrap，远端创建两份文件。
 */
export declare function coerceDeferredToolParams(input: unknown): Record<string, any>;
/** SDK `parameters.parse` 用：接受 object 或 JSON string，统一成 plain object。 */
export declare const deferredToolParametersSchema: z.ZodEffects<z.ZodObject<{}, "passthrough", z.ZodTypeAny, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, z.objectInputType<{}, z.ZodTypeAny, "passthrough">>, z.objectOutputType<{}, z.ZodTypeAny, "passthrough">, unknown>;
/**
 * Bridge that registers `globalThis.__codebuddyResolveDeferredTool`.
 *
 * When the SDK's tool-resolution loop (`resolveFunctionOrHandoff` in the patched
 * @openai/agents-core) fails to find a tool in the functionMap, the patch consults
 * this bridge. If the bridge returns a synthetic FunctionTool, the SDK executes it
 * transparently — no ModelBehaviorError, no wasted round-trip, no user-visible error.
 *
 * The synthetic tool wraps the original call parameters and routes through
 * `DeferExecuteTool.execute()`, reusing all existing logic (param validation, MCP
 * routing, ACP broadcast, permission checks).
 *
 * **Code Mode 例外（Issue #123022）**：Code Mode（PTC / Minimal / 协调器 overlay）
 * 下 REPL 是唯一直连工具，这条桥必须让位——`invoke` 检测到 Code Mode 就不再执行，
 * 改为返回 Code Mode 引导（把工具指回 REPL 沙箱）；`needsApproval` 同步短路，
 * 避免空审批弹窗。overlay 轮沙箱本就不收 MCP，重叠由派出的子代理承接。
 */
export declare class DeferredToolBridge {
    protected readonly logger: Logger;
    /**
     * Registers the global resolver bridge. Called once during CellJS container init.
     * Uses lazy ContainerUtil access at RESOLUTION time to avoid circular DI.
     */
    init(): void;
    /**
     * Code Mode 直连调用的纯引导工具：不执行任何能力，只把 REPL 写法作为工具错误结果
     * 回给模型，让模型当轮改写。invoke 时按本轮 RunContext 的会话再判一次——解析时
     * 读的是 ALS 当前会话，二者不一致时退回通用的「工具不存在」结果。
     */
    private buildCodeModeGuidanceTool;
    /**
     * Build a synthetic SDK-compatible FunctionTool for the given deferred tool.
     * The `invoke` method wraps the original arguments into DeferExecuteTool's
     * `{ toolName, params }` shape and delegates execution.
     *
     * `sandboxCallName` = 该工具在 REPL 沙箱里的准确调用名（延迟索引的
     * serverName/rawToolName 拼出）；Code Mode 拒绝直连时用它给引导。
     */
    private buildSyntheticTool;
}
