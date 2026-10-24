export type ResourceScope = { id: string; name: string; path?: string; kind: "global" | "project" };
export type ResourceItem = {
  id: string;
  kind: "skill" | "mcp" | "package";
  scopeId: string;
  name: string;
  description: string;
  source: string;
  version?: string;
  managed: boolean;
  removable: boolean;
  removalPending?: boolean;
  movable?: boolean;
  moveBlockedReason?: string;
  cleanup: string[];
  note?: string;
  /** Built-ins ship inside the REA or OpenCLI package and stay read-only here. */
  builtin?: "rea" | "opencli";
};
export type ResourceDetail = {
  id: string;
  revision: string;
  location: string;
  source?: string;
  bin?: string;
  config?: string;
  masked: boolean;
  documents: { path: string; name: string; content: string; editable: boolean }[];
  warnings: string[];
};
export type ResourceJob = {
  id: string; running: boolean; message: string; error?: string; label?: string;
  scopeId?: string; operation?: string; targetId?: string; resource?: string;
  resourceId?: string; version?: string; commit?: string;
};
export type ResourceState = {
  revision: string;
  items: ResourceItem[];
  scopes: ResourceScope[];
  warnings: string[];
  /** Complete job collection; job remains a compatibility view of the latest admission. */
  jobs?: ResourceJob[];
  acceptedJobId?: string;
  job?: ResourceJob;
};
