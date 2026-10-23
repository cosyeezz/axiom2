export const reaVersion = "6.7.0";
export type ReaJob = { id: string; kind: "check" | "install" | "doctor"; running: boolean; message: string; error?: string };
export type ReaState = {
  revision: string;
  enabled: boolean;
  skillInstalled: boolean;
  mcpInstalled: boolean;
  skillError?: string;
  mcpError?: string;
  nodeVersion: string;
  supported: boolean;
  version?: string;
  latest?: string;
  packageRoot?: string;
  job?: ReaJob;
  diagnostic?: { text: string; toolCount: number; at: number };
  error?: string;
};
export const emptyReaState: ReaState = { revision: "", enabled: true, skillInstalled: false, mcpInstalled: false, nodeVersion: "", supported: false };
