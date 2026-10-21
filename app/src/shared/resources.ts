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
  cleanup: string[];
  note?: string;
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
export type ResourceState = {
  revision: string;
  items: ResourceItem[];
  scopes: ResourceScope[];
  warnings: string[];
  job?: { id: string; running: boolean; message: string; error?: string };
};
