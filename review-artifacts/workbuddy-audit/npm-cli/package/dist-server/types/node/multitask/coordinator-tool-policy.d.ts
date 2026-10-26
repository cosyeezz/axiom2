import { type ToolResult } from '../tools/tool-protocol';
import { type MultitaskSessionRef } from './types';
export declare const COORDINATOR_TOOL_ALLOWLIST_NAMES: readonly ["Agent", "TaskOutput", "TaskStop", "InterruptAgent", "ListAgents", "InspectSelf", "AskUserQuestion", "SendUserMessage", "Grep", "Read"];
export declare function noteCoordinatorBatchTool(session: object | undefined, toolName: string): void;
/** planner 在 gate 之前 note 之后调用，避免 pending=0 时下一发 gate 拆掉本轮 Agent。 */
export declare function holdCoordinatorToolBatch(session?: object): void;
export declare function getCoordinatorBatchTools(session?: object): ReadonlySet<string>;
/** 每轮协调器 run 开头换新集合，并绑定到当前异步链，避免重叠 run 串批。 */
export declare function beginCoordinatorToolBatch(session?: object): void;
/** 轮次开头：已有 in-flight gate 时不拆掉当前波。 */
export declare function beginCoordinatorToolBatchIfIdle(session?: object): void;
export declare function resetCoordinatorBatchToolsForTests(): void;
/** 同波探测：Grep/Read 仅本 run 无 Agent 才放行；批次由下一 run 显式重置。 */
export declare function gateCoordinatorTool(session: MultitaskSessionRef | null | undefined, toolName: string, callId?: string): Promise<ToolResult | null>;
/** 非协调器/白名单 → null。Grep/Read 须本波已探测且无 Agent。禁止 throw。 */
export declare function evaluateCoordinatorTool(session: MultitaskSessionRef | null | undefined, toolName: string, callId?: string): ToolResult | null;
/**
 * 委托 overlay 协调者的原生直连白名单：只能派工与沟通，
 * 读文件 / 搜索 / 编辑全部交给 worker。
 */
export declare const DELEGATE_ALLOWED_TOOL_NAMES: readonly string[];
/**
 * Code Mode 下 REPL 沙箱内的委托白名单：在原生名单上补 TaskOutput（读 worker 完整报告，
 * 与 PTC 协调器面的 `await TaskOutput({ task_id, block: false })` 契约一致）。
 */
export declare const DELEGATE_CODE_MODE_SANDBOX_TOOL_NAMES: readonly string[];
export declare const DELEGATE_MODE_FORBIDDEN = "DELEGATE_MODE_FORBIDDEN";
/**
 * 当前会话本身是委托 overlay 协调者。与权限模式正交：bypassPermissions / fullAccess 下同样
 * 命中，工具限制只由本判定驱动的工具面与执行期闸门负责。worker / 子会话恒 false
 * （isCoordinatorMode 按 role/parent 排除，markWorkerSession 也会剥掉 delegateMode）。
 */
export declare function isDelegateCoordinator(session?: MultitaskSessionRef | null): boolean;
/**
 * 委托模式工具面的**唯一判定源**：直连层 isEnabled、REPL 沙箱目录（经 codeModeSpecOf）、
 * DeferExecute 与执行期闸门共用。非委托会话恒为 true。
 *
 * `codeMode`：会话处于 PTC / Minimal。此时直连层只有 REPL（派发入口，语义同
 * isCoordinatorDispatchSurface），协调工具在沙箱内以 `await Agent(...)` 调用。
 */
export declare function isDelegateAllowedTool(session: MultitaskSessionRef | null | undefined, toolName: string, codeMode: boolean): boolean;
/** 委托模式执行期闸门：名单外工具直接 deny（含 REPL 沙箱内调用）。非委托会话返回 null。 */
export declare function gateDelegateTool(session: MultitaskSessionRef | null | undefined, toolName: string, codeMode: boolean): ToolResult | null;
/** 协调器派工/进度要对用户可见。TaskStop 仍藏。 */
export declare function shouldRevealCoordinatorToolCall(toolName: string): boolean;
