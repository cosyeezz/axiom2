export type PiPackageRequest = { action: "install" | "remove"; source: string; cwd: string; agentDir: string; local: boolean; fromSettings?: boolean };
export type PiPackageResult = { installedPath?: string; version?: string; commit?: string };
export type PiPackageReply = { ok: true; result: PiPackageResult } | { ok: false };
