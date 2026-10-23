import type { Scope } from "./protocol.js";

export const reloadScope = (scope: Scope) => `reload:${scope.workspaceId}:${scope.sessionId}`;
export const resourceKinds = ["skills", "extensions", "prompts", "themes", "instructions", "tools", "settings"] as const;
export type ResourceKind = typeof resourceKinds[number];
export const resourceLabels: Record<ResourceKind, string> = { skills: "Skills", extensions: "扩展", prompts: "提示词模板", themes: "主题", instructions: "项目指令", tools: "可用工具", settings: "会话配置" };
export interface ReloadResource { name: string; revision: string }
export type ResourceSnapshot = Record<ResourceKind, ReloadResource[]>;
export type ReloadStage = "waiting" | "preparing" | "reloading" | "comparing" | "completed" | "failed";
export interface ReloadState {
  kind?: "skills";
  id: string;
  status: "running" | "completed" | "failed";
  stage: ReloadStage;
  startedAt: number;
  endedAt?: number;
  runId?: string;
  resumed?: boolean;
  before?: ResourceSnapshot;
  after?: ResourceSnapshot;
  warnings?: string[];
  error?: string;
  steps: { stage: ReloadStage; at: number }[];
}
export function resourceChanges(before: ReloadResource[] | undefined, after: ReloadResource[]) {
  if (!before) return { added: [], removed: [], changed: [], unknown: true };
  const old = new Map(before.map(item => [item.name, item.revision]));
  const next = new Map(after.map(item => [item.name, item.revision]));
  return {
    added: after.filter(item => !old.has(item.name)).map(item => item.name),
    removed: before.filter(item => !next.has(item.name)).map(item => item.name),
    changed: after.filter(item => old.has(item.name) && old.get(item.name) !== item.revision).map(item => item.name),
    unknown: false,
  };
}
