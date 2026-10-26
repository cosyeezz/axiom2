export type EnvironmentLocation = {
  path: string; purpose: string; state: "present" | "missing" | "unknown" | "link";
  bytes: number; files: number; links: number; complete: boolean; issues: string[];
};
export type EnvironmentItem = {
  id: string; label: string; note: string; state: "detected" | "missing" | "unknown";
  locations: EnvironmentLocation[];
};
export type EnvironmentInventory = {
  scope?: "current" | "selected"; origin?: "unknown"; automaticRemovalAllowed?: false;
  residuals?: { items: (EnvironmentLocation & { automaticRemovalAllowed: false; retention: string })[]; complete: boolean; issues: string[] };
  root: string; items: EnvironmentItem[];
  commands: { command: string; path: string; link: boolean }[];
  pathIncomplete: boolean; entries: number; elapsedMs: number; notes: string[];
};

export function isEnvironmentInventory(value: unknown): value is EnvironmentInventory {
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(item => typeof item === 'string');
  const count = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const location = (v: unknown) => record(v) && typeof v.path === 'string' && typeof v.purpose === 'string'
    && ['present', 'missing', 'unknown', 'link'].includes(String(v.state)) && count(v.bytes) && count(v.files) && count(v.links)
    && typeof v.complete === 'boolean' && strings(v.issues);
  if (!record(value) || typeof value.root !== 'string' || !Array.isArray(value.items) || !Array.isArray(value.commands)
    || !strings(value.notes) || typeof value.pathIncomplete !== 'boolean' || !count(value.entries) || !count(value.elapsedMs)
    || ![undefined, 'current', 'selected'].includes(value.scope as string | undefined)
    || value.origin !== undefined && value.origin !== 'unknown'
    || value.automaticRemovalAllowed !== undefined && value.automaticRemovalAllowed !== false) return false;
  if (!value.items.every(item => record(item) && typeof item.id === 'string' && typeof item.label === 'string' && typeof item.note === 'string'
    && ['detected', 'missing', 'unknown'].includes(String(item.state)) && Array.isArray(item.locations) && item.locations.every(location))
    || !value.commands.every(command => record(command) && typeof command.command === 'string' && typeof command.path === 'string' && typeof command.link === 'boolean')) return false;
  const residuals = value.residuals;
  return residuals === undefined || record(residuals) && typeof residuals.complete === 'boolean' && strings(residuals.issues)
    && Array.isArray(residuals.items) && residuals.items.every(item => record(item) && location(item) && item.automaticRemovalAllowed === false && typeof item.retention === 'string');
}
