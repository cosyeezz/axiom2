import type { CostCategory, CostRow, CostTotals } from "./costs.js";

export const usageProvidersScope = "usage:providers";
export type UsageProvider = {
  id: string;
  name: string;
  configured: boolean;
  query: "shared" | "unsupported";
  revision: string;
  management?: { label: string; url: string };
};
export type UsageRecord = CostRow & {
  workspaceId: string;
  workspaceName: string;
  rootSessionId: string;
  sessionTitle: string;
  name?: string;
  kind: "call" | "aggregate" | "unavailable";
};
export type UsageAgentRole = "main" | "subagent";
export type UsageRequestType = UsageAgentRole | "compression";
export type UsageSessionDirectory = {
  sessions: { id: string; title: string; workspaceId: string; workspaceName: string }[];
  truncated: boolean;
};
export type UsageRecordFilter = {
  workspaceId?: string;
  providerId?: string | null;
  /** Accounting attributed to this main-session family, including its subagents. */
  rootSessionId?: string;
  agentRole?: UsageAgentRole;
  /** Main/subagent ownership, or compression accounting across both roles. */
  requestType?: UsageRequestType;
  query?: string;
  from?: number;
  to?: number;
  page?: number;
  pageSize?: number;
  snapshot?: string;
  refresh?: boolean;
  /** Advance the bounded source scan; independent from record pagination. */
  continue?: boolean;
  /** Opt-in, bounded chart aggregates over the same filtered snapshot, never the current page. */
  analytics?: boolean;
  /** IANA browser time zone used to group real timestamps into local calendar days. */
  timeZone?: string;
};
export type UsageAggregate = { key: string; label: string; count: number; total: CostTotals; other?: boolean };
export type UsageBreakdown = { tokens: UsageAggregate[]; cost: UsageAggregate[] };
export type UsageAnalytics = {
  timeZone: string;
  bucketDays: number;
  trend: { from: string; to: string; count: number; total: CostTotals }[];
  undated: { count: number; total: CostTotals };
  models: UsageBreakdown;
  workspaces: UsageBreakdown;
  providers: UsageBreakdown;
};
export type UsageBackground = {
  state: "preparing" | "updating" | "ready" | "error";
  /** Conservative source-scan watermark, not the time of this query. */
  verifiedThrough: number;
  publishedAt?: number;
  message?: string;
};
export type UsageRecordPage = {
  background?: UsageBackground;
  rows: UsageRecord[];
  total: CostTotals;
  count: number;
  page: number;
  pageSize: number;
  snapshot: string;
  updatedAt: number;
  scannedRoots: number;
  totalRoots: number;
  /** Families visited, including sources that could not be completely verified. */
  processedRoots?: number;
  /** More bounded scan work is available for this snapshot. */
  building?: boolean;
  partial: boolean;
  warnings: string[];
  providers: (string | null)[];
  analytics?: UsageAnalytics;
};
export type ProviderStatistics = {
  provider: string | null;
  total: CostTotals;
  categories: { category: CostCategory; total: CostTotals }[];
  byWorkspace: { id: string; name: string; roots: number; total: CostTotals }[];
};
export type ModelUsageStatistics = {
  background?: UsageBackground;
  updatedAt: number;
  total: CostTotals;
  models: { provider: string | null; model: string | null; name?: string; total: CostTotals }[];
  providers: ProviderStatistics[];
  categories: { category: CostCategory; total: CostTotals }[];
  workspaces: { id: string; name: string }[];
  byWorkspace: { id: string; name: string; roots: number; total: CostTotals }[];
  scannedRoots: number;
  totalRoots: number;
  partial: boolean;
  warnings: string[];
};
