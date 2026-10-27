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
export interface SelectionChange {
  from: Selection;
  to: Selection;
}
export type RunPhase = "initializing" | "requesting" | "generating" | "executing_tools" | "retry_wait" | "retrying" | "compacting" | "settling";
export interface RetryInfo {
  runId: string;
  episodeId: string;
  attempt: number;
  maxAttempts: number;
  state: "waiting" | "retrying" | "succeeded" | "exhausted" | "cancelled";
  nextRetryAt?: number;
  message?: string;
}
export interface RetrySettings {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
  maxAgentDelayMs: number;
  provider: { maxRetries?: number; maxRetryDelayMs: number; timeoutMs?: number };
}
export const runOriginLabels = {
  task_notification: "任务结果通知后续跑",
  memory_continuation: "按记忆进度续跑",
  compression_preparation: "压缩前记忆维护",
  manual_resume: "手动继续执行",
} as const;
export type RunOrigin = keyof typeof runOriginLabels;
/** Only explicit host facts have a source; legacy runs stay unknown. */
export const readRunOrigin = (value: unknown): RunOrigin | undefined =>
  typeof value === "string" && Object.hasOwn(runOriginLabels, value) ? value as RunOrigin : undefined;
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
  reasonCode?: string | null;
  phase?: RunPhase | null;
  retry?: RetryInfo | null;
  resumedFromRunId?: string | null;
  /** Display-only source. Never grants continuation permission or changes billing. */
  origin?: RunOrigin;
}
export interface EnvironmentTool {
  name: string;
  description: string;
  parameters: unknown;
}
export interface EnvironmentSkill {
  name: string;
  description: string;
  path: string;
  automatic: boolean;
}
export interface SessionEnvironment {
  cwd: string;
  /** Missing in older execution snapshots. Preview is never an execution receipt. */
  systemPrompt?: string;
  source?: "preview" | "runtime";
  tools: string[];
  toolDefinitions?: EnvironmentTool[];
  skills: string[];
  skillDetails?: EnvironmentSkill[];
  mcp?: { name: string; description: string; source: string }[];
  /** Exact Topic directory injected separately from the system prompt. */
  memory?: { topics: string };
  extensions: number;
  warnings: string[];
  retry?: RetrySettings;
}
export interface AgentInfo {
  activeTaskCount?: number;
  queue?: { id: string; text: string; mode: "steer" | "followUp"; skills?: import("./skills.js").SkillReference[] }[];
  task?: {
    id: string;
    parentSessionId: string;
    status: import("./tasks.js").TaskStatus;
  };
  selection: Selection | null;
  run: Run | null;
  /** Sum of this session's persisted runs with an end time; excludes the active run. */
  completedRunDurationMs?: number;
  /** Main-session memory location; null for child sessions. Independent of initialization. */
  memoryDirectory?: string | null;
  environment: SessionEnvironment | null;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
    cost: number | null;
    /** Native input usage of the latest model response on this branch; never cumulative. */
    lastRequest?: { input: number; cacheRead: number; cacheWrite: number } | null;
    /** Latest actual Kiro attempt only, not cumulative measurement or a service bill. */
    lastMeasurement?: import("./kiro-usage.js").KiroUsageInfo;
    context: {
      tokens: number | null;
      window: number;
      percent: number | null;
      /** Content-based pi estimate while post-compaction provider usage is unavailable. */
      estimated?: boolean;
    } | null;
  } | null;
}
export interface ChatMessage {
  /** Allowlisted terminal Kiro failure metadata; never raw provider diagnostics. */
  kiroFailure?: import("./kiro-failure.js").KiroFailureDisplay;
  /** Ephemeral worker-to-view timing; never written into native model history. */
  deliveryTiming?: import("./latency.js").DeliveryTiming;
  skills?: import("./skills.js").SkillReference[];
  id: string;
  role: "user" | "assistant" | "toolResult" | "notice";
  text: string;
  thinking?: string;
  thinkingActive?: boolean;
  /** Safe display phase only; provider signatures never cross IPC. */
  phase?: "commentary" | "final_answer";
  /** Display-only terminal task notice; native result payload stays in the agent context. */
  taskNotice?: "completed" | "cancelled" | "failed" | "interrupted" | "unknown";
  resultId?: string;
  /** Metadata only. Paths use files.preview; native blocks use message.image + this message's id. */
  /** Path attachment metadata for shared inline reference rendering; no file contents. */
  attachments?: Pick<import("./protocol.js").Attachment, "id" | "kind" | "name" | "path">[];
  images?: (Omit<import("./protocol.js").ImageAttachment, "data"> & { path?: string })[];
  calls?: { id: string; name: string; input: string; inputLength?: number; inputRevision?: string; taskPreview?: { titles?: string[]; taskId?: string; summary?: string; reason?: string }; summary?: { label: string; icon: import("./tool-summary.js").ToolIcon; target: string; detail: string } }[];
  /** Compact display fields; full records remain in the native transcript. */
  textLength?: number;
  textRevision?: string;
  thinkingLength?: number;
  thinkingRevision?: string;
  /** Bounded live tail for the collapsed scrolling preview; thinking keeps its original prefix. */
  thinkingTail?: string;
  detailsRevision?: string;
  preview?: string;
  toolName?: string;
  toolCallId?: string;
  /** Epoch milliseconds of the live tool start event; absent for unknown historical timing. */
  toolStartedAt?: number;
  durationMs?: number;
  status?: "running" | "completed" | "failed" | "cancelled";
  error?: string;
  streaming?: boolean;
  truncated?: boolean;
  compression?: { number: number; title: string; before: number; after: number | null };
  inputIds?: string[];
  /** Host-proven appended input (including edit/resend); visible, not a new task boundary. */
  inputContinuation?: boolean;
  /** Display metadata from an actual model request, never the menu draft. */
  selectionChange?: SelectionChange;
  runId?: string;
  /** Read-only projection from the owning run, not model-supplied transcript content. */
  runOrigin?: RunOrigin;
}
/** One hidden message field, always returned in full. */
export interface MessagePart {
  text: string;
  totalLength: number;
  revision: string;
}
export interface ThreadIndex {
  ids: string[];
  groups?: {
    id: string;
    ids: string[];
    activity: boolean;
    /** Existing execution identities, without hydrating archived message bodies. */
    runIds?: string[];
    /** A finished final-answer body; available even while its virtual row is unmounted. */
    delivery?: boolean;
    /** A confirmed final reply folds all preceding process content in this segment. */
    folded?: boolean;
    /** Contains task cards which remain visible until a completed delivery. */
    hasTasks?: boolean;
    /** These messages contribute only thinking before their body. */
    thinkingOnlyIds?: string[];
    /** These messages contribute only calls after their body. */
    callsOnlyIds?: string[];
    /** Thinking and calls contribute, but this message's separately rendered body does not. */
    bodyHiddenIds?: string[];
    /** Process content is rendered separately from this body. */
    hideThinking?: boolean;
    selectionChange?: SelectionChange;
  }[];
  error?: string;
  /** Reading watermark published with this rendered context, never inferred from the sidebar. */
  /** Monotonic within the server stream; advances on authoritative history rebuilds. */
  contextRevision?: number;
  resultVersion?: number;
  readVersion?: number;
  resultTasks?: { taskId: string; resultId: string }[];
  runId?: string;
  runStatus?: Run["status"];
  runPhase?: RunPhase | null;
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
export const emptyThread: ThreadIndex = { ids: [] };
export const activeStatus = (status: string | null | undefined) =>
  ["starting", "running", "stopping"].includes(status ?? "");
export const running = (run: Run | null | undefined) => activeStatus(run?.status);
export const runLabels: Record<Run["status"], string> = {
  starting: "正在初始化",
  running: "执行中",
  stopping: "正在停止",
  completed: "已完成",
  failed: "失败",
  cancelled: "已停止",
  interrupted: "执行中断",
};
