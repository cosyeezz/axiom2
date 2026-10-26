import type { FunctionCallItem } from '../../vendor/cbc-shared/node/index.js';
import { type ToolResult } from '../tools/tool-protocol';
import type { MultitaskSessionRef } from './types';
/** 沙箱揭示只需盖章面 + combineSubject，单测不必拉齐完整 Session。 */
export type SandboxRevealSession = MultitaskSessionRef & {
    combineSubject?: {
        next(event: unknown): void;
    };
};
/**
 * REPL 沙箱里只有 Agent 提成对话层卡片。
 *
 * 有两类会话会把 Agent 派发藏在 REPL 里：
 * - multitask 协调器（标准模式叠加 overlay）；
 * - Code Mode 主会话（PTC / Minimal，REPL 就是唯一直连工具面）。
 *
 * 后者此前被漏掉：`isMultitaskCoordinator(session)` 为 false，Agent() 的卡片
 * 既不进父会话，Web UI 上就只剩一张 REPL 卡，看不到任何子代理。Code Mode 的
 * 唯一事实源是 `isReplEnabled` / `codeModeSpecOf`，这里直接复用它。
 */
export declare function shouldRevealSandboxCoordinatorTool(session: SandboxRevealSession | undefined, toolName: string): boolean;
export declare function createSandboxAgentToolCall(params: Record<string, unknown>): FunctionCallItem;
/** 把 REPL 里的 Agent() 推到 combineSubject；不落 history。 */
export declare function revealSandboxCoordinatorTool(session: SandboxRevealSession | undefined, item: FunctionCallItem | {
    type: 'function_call_result';
    callId: string;
    name: string;
    output: {
        type: 'text';
        text: string;
    };
    providerData?: {
        toolResult?: ToolResult;
    };
}): void;
export declare function revealSandboxAgentResult(session: SandboxRevealSession | undefined, callId: string, result: ToolResult): void;
/** REPL 内层工具统一携带 synthetic callId；仅 Agent() 额外投影对话卡片。 */
export declare function routeCoordinatorSandboxTool(opts: {
    session: SandboxRevealSession | undefined;
    toolName: string;
    params: Record<string, unknown>;
    /** 由 broker 上提的内层 callId；缺省时现造，保证与 PermissionRequest / Pre/Post 一致。 */
    callId?: string;
    route: (details?: {
        toolCall: FunctionCallItem;
    }) => Promise<ToolResult>;
}): Promise<ToolResult>;
