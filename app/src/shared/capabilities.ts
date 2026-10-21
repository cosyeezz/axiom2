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
  preferenceKey?: string;
  defaultSelected: boolean;
  available: boolean;
};
export type CapabilityCatalog = {
  sessionSkills?: CapabilityItem[];
  preferencesRevision: number;
  state: CapabilityState;
  revision: string;
  skills: CapabilityItem[];
  mcp: CapabilityItem[];
  warnings: string[];
  mcpPaths: string[];
};
export type CapabilityPreferences = { revision: number; skills: Record<string, boolean>; mcp: Record<string, boolean> };
export const capabilityPreferencesScope = "capability-preferences";
export const capabilitiesScope = (scope: Scope) => `capabilities:${scope.workspaceId}:${scope.sessionId}`;
