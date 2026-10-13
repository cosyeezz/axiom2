import type { Scope } from "./protocol.js";

export interface Compression {
  id: string;
  requestId: string;
  state: "running" | "completed" | "cancelled" | "failed" | "interrupted";
  phase: "snapshot" | "summarizing" | "done";
  startedAt: number;
  endedAt: number | null;
  messageCount: number;
  before: number | null;
  after: number | null;
  summary: string;
  error: string | null;
  selection: { provider: string; id: string };
  usage: {
    input: number;
    output: number;
    total: number;
    cost: number | null;
  } | null;
}
export const compressionScope = (s: Scope) =>
  `compression:${s.workspaceId}:${s.sessionId}`;
export const compressionLabels: Record<Compression["state"], string> = {
  running: "进行中",
  completed: "已完成",
  cancelled: "已取消",
  failed: "失败",
  interrupted: "已中断",
};
export const compressionLimitMs = 120000;
