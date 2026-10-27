import type { CostCategory, CostRow, CostTotals } from "./costs.js";
import type { ProviderProxy } from "./models.js";

export const usageAuthScope = "usage:authentication";
export const usageProvidersScope = "usage:providers";
export const usageProviderId = "openai-codex";
export type UsageAccount = {
  providerId: typeof usageProviderId;
  configured: boolean;
  expired: boolean;
  revision: string;
  generation: string;
  proxy: ProviderProxy;
};
export type UsageProvider = {
  id: string;
  name: string;
  configured: boolean;
  query: "shared" | "codex" | "unsupported";
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
  query?: string;
  from?: number;
  to?: number;
  page?: number;
  pageSize?: number;
  snapshot?: string;
  refresh?: boolean;
  /** Advance the bounded source scan; independent from record pagination. */
  continue?: boolean;
};
export type UsageRecordPage = {
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
};
export type ProviderStatistics = {
  provider: string | null;
  total: CostTotals;
  categories: { category: CostCategory; total: CostTotals }[];
  byWorkspace: { id: string; name: string; roots: number; total: CostTotals }[];
};
export type ModelUsageStatistics = {
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
