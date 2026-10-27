export const backendUpdatesScope = "backend-updates";
export const stableVersion = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(value);
export function newerBackendVersion(next: string, current: string) {
  if (!stableVersion(next) || !stableVersion(current)) return false;
  const a = next.split(".").map(Number), b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export type BackendUpdateState = {
  runningVersion: string | null;
  latest: { version: string; url: string } | null;
  checkedAt: number | null;
  checking: boolean;
  available: boolean;
  pending: boolean;
  error: string | null;
};
export type BackendUpdateReply = BackendUpdateState & { notice?: string | null };
export type BackendUpdateAction = "get" | "check" | "present" | "dismiss";
export function validBackendUpdate(value: unknown): value is BackendUpdateReply {
  if (!value || typeof value !== "object") return false;
  const v = value as BackendUpdateReply;
  return (v.runningVersion === null || stableVersion(v.runningVersion)) &&
    (v.latest === null || stableVersion(v.latest?.version) && v.latest.url === `https://github.com/cosyeezz/axiom2/releases/tag/v${v.latest.version}`) &&
    (v.checkedAt === null || Number.isFinite(v.checkedAt)) && typeof v.checking === "boolean" &&
    typeof v.available === "boolean" && typeof v.pending === "boolean" && (v.error === null || typeof v.error === "string") &&
    (v.notice === undefined || v.notice === null || stableVersion(v.notice));
}
