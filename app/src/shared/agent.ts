import type { Scope } from "./protocol.js";

export const thinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type Thinking = (typeof thinkingLevels)[number];
export interface Selection {
  provider: string;
  id: string;
  thinking: Thinking;
}
export interface Run {
  id: string;
  sessionId: string;
  status:
    | "starting"
    | "running"
    | "stopping"
    | "completed"
    | "failed"
    | "cancelled"
    | "interrupted";
  selection: Selection;
  startedAt: number;
  endedAt: number | null;
  error: string | null;
  cleanup: "pending" | "confirmed" | "unconfirmed";
}
export interface AgentInfo {
  phase?: string;
  selection: Selection | null;
  run: Run | null;
  environment: {
    cwd: string;
    tools: string[];
    skills: string[];
    extensions: number;
    warnings: string[];
  } | null;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
    cost: number | null;
    context: {
      tokens: number | null;
      window: number;
      percent: number | null;
    } | null;
  } | null;
}
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "toolResult" | "notice";
  text: string;
  thinking?: string;
  calls?: { id: string; name: string; input: string }[];
  toolName?: string;
  toolCallId?: string;
  durationMs?: number;
  status?: "running" | "completed" | "failed" | "cancelled";
  error?: string;
  streaming?: boolean;
  truncated?: boolean;
}
export interface ThreadIndex {
  ids: string[];
  before: string | null;
  error?: string;
}
export const agentScope = (s: Scope) => `agent:${s.workspaceId}:${s.sessionId}`;
export const threadScope = (s: Scope) =>
  `thread:${s.workspaceId}:${s.sessionId}`;
export const messageScope = (s: Scope, id: string) =>
  `message:${s.workspaceId}:${s.sessionId}:${id}`;
export const emptyAgent: AgentInfo = {
  selection: null,
  run: null,
  environment: null,
  usage: null,
};
export const emptyThread: ThreadIndex = { ids: [], before: null };
export const running = (run: Run | null | undefined) =>
  !!run && ["starting", "running", "stopping"].includes(run.status);
export const runLabels: Record<Run["status"], string> = {
  starting: "正在初始化",
  running: "执行中",
  stopping: "正在停止",
  completed: "已完成",
  failed: "失败",
  cancelled: "已停止",
  interrupted: "执行中断",
};
