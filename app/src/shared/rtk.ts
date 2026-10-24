import type { CleanupScope } from "./cleanup-scope.js";
export const rtkLevels = ["conservative", "balanced", "aggressive"] as const;
export type RtkLevel = typeof rtkLevels[number];
export type RtkSettings = { enabled: boolean; level: RtkLevel; subagents: boolean };
export const defaultRtkSettings: RtkSettings = { enabled: false, level: "balanced", subagents: true };
export const rtkPolicies = {
  conservative: { label: "保守", minimum: 2048, saving: 0.2, description: "测试与检查；至少 2 KiB，净缩减至少 20%。" },
  balanced: { label: "均衡", minimum: 1024, saving: 0.1, description: "增加 Git 状态和文件列表；至少 1 KiB，净缩减至少 10%。" },
  aggressive: { label: "强力", minimum: 512, saving: 0.05, description: "增加搜索结果和 Git diff；至少 512 B，净缩减至少 5%。可能省略匹配项和补丁细节。" },
} as const;
export const rtkReasons = {
  filtered: "已缩减", unsupported: "命令或格式不支持", small: "输出低于门槛", error: "原工具出错", truncated: "原输出已截断",
  nested: "嵌套工具调用", contract: "非标准文本结果", missing: "程序不可用", cancelled: "已取消", failed: "过滤失败或超时",
  unchanged: "净缩减不足", storage: "原文保存失败",
} as const;
export type RtkReason = keyof typeof rtkReasons;
export type RtkEvent = { id: string; at: number; role: "main" | "subagent"; level: RtkLevel; filter: string; reason: RtkReason; inputBytes: number; outputBytes: number; durationMs: number; version: string };
export type RtkStats = { days: number; count: number; filtered: number; inputBytes: number; outputBytes: number; durationMs: number; reasons: { reason: RtkReason; count: number }[]; recent: RtkEvent[]; error?: string };
export const emptyRtkStats: RtkStats = { days: 7, count: 0, filtered: 0, inputBytes: 0, outputBytes: 0, durationMs: 0, reasons: [], recent: [] };
export type RtkDataScope = CleanupScope & { count: number; retained: string[] };
export type RtkJob = { id: string; kind: "check" | "install" | "doctor" | "uninstall" | "cleanupStats" | "cleanupOriginals"; running: boolean; message: string; error?: string };
export type RtkState = {
  revision: string; settings: RtkSettings; version?: string; executable?: string; latest?: string; platform: string; supported: boolean; supportError?: string;
  job?: RtkJob; diagnostic?: { text: string; at: number }; error?: string; removalPending?: boolean;
  /** Exact desktop offline preview; its revision also binds directory identities. */
  cleanup?: CleanupScope;
  cleanupPaths?: string[]; offline?: boolean;
  offlineUninstall?: { allowed: false; reason: string };
  dataCleanup?: Partial<Record<"stats" | "originals", RtkDataScope>>;
  dataCleanupErrors?: Partial<Record<"stats" | "originals", string>>; dataCleanupError?: string;
};
export const emptyRtkState: RtkState = { revision: "", settings: defaultRtkSettings, platform: "", supported: false };
