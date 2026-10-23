import type { Scope } from "./protocol.js";

/** Skills select automatic model discovery; all catalog skills remain explicitly usable.
 * null preserves legacy native discovery. MCP selects servers to connect. */
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
  /** Built-in names resolve from their integration first, then general sources. */
  builtin?: "rea" | "opencli";
  fallback?: boolean;
  preferenceKey?: string;
  defaultSelected: boolean;
  available: boolean;
};
export type CapabilityReloadSelection = { target: "session" | "defaults"; revision: number; catalogRevision: string; skills: string[]; mcp: string[] };
export type SkillSelectionChange = { revision: number; catalogRevision: string; id: string; checked: boolean };
export type CapabilityCatalog = {
  sessionSkillsEditable: boolean;
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
