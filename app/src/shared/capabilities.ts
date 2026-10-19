import type { Scope } from "./protocol.js";

export type CapabilitySelection = { skills: string[] | null; mcp: string[] };
export type CapabilityState = {
  revision: number;
  locked: boolean;
  legacy: boolean;
  selection: CapabilitySelection | null;
};
export type CapabilityItem = {
  id: string;
  name: string;
  description: string;
  source: string;
  defaultSelected: boolean;
  available: boolean;
};
export type CapabilityCatalog = {
  state: CapabilityState;
  revision: string;
  skills: CapabilityItem[];
  mcp: CapabilityItem[];
  warnings: string[];
  mcpPaths: string[];
};
export const capabilitiesScope = (scope: Scope) => `capabilities:${scope.workspaceId}:${scope.sessionId}`;
