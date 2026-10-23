import type { Selection } from "./agent.js";
export type ProcessingKind = "memory.organize" | "memory.query" | "compression";
export type ProcessingState = "running" | "cancelling" | "completed" | "failed" | "cancelled" | "interrupted" | "invalidated";
export interface ProcessingSummary {
  id: string; workspaceId: string; sessionId: string; kind: ProcessingKind; title: string;
  state: ProcessingState; stage: string; startedAt: number; endedAt: number | null;
  error: string | null; selection?: Selection; legacy?: boolean;
}
export interface ProcessingPayload { text: string; truncated: boolean }
export interface ProcessingCall {
  id: string; stage: string; state: ProcessingState; startedAt: number; sentAt?: number; endedAt: number | null;
  selection?: Selection; input?: ProcessingPayload; output?: ProcessingPayload; usage?: unknown; error?: string;
}
export interface ProcessingRecord extends ProcessingSummary {
  stages: { name: string; at: number }[]; calls: ProcessingCall[]; result?: ProcessingPayload;
}
export interface ProcessingList { items: ProcessingSummary[]; next: number | null }
export const processingKinds: Record<ProcessingKind, string> = { "memory.organize": "记忆整理", "memory.query": "记忆查询", compression: "上下文压缩" };
export const processingStates: Record<ProcessingState, string> = { running: "进行中", cancelling: "取消中", completed: "成功", failed: "失败", cancelled: "已取消", interrupted: "已中断", invalidated: "结果已失效" };
