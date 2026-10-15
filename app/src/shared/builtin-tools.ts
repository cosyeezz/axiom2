export type OpenCliSettings = {
  enabled: boolean;
  profile: string;
  window: "foreground" | "background";
};
export type OpenCliJob = {
  id: string;
  kind: "refresh" | "check" | "install" | "doctor";
  running: boolean;
  message: string;
  error?: string;
};
export type OpenCliState = {
  ready: boolean;
  nodeVersion: string;
  npmVersion?: string;
  version?: string;
  latest?: string;
  packageRoot?: string;
  configured: boolean;
  revision: string;
  settings: OpenCliSettings;
  job?: OpenCliJob;
  diagnostic?: { text: string; checkedAt: number };
  installationError?: string;
  error?: string;
};
export const defaultOpenCliSettings: OpenCliSettings = { enabled: true, profile: "", window: "foreground" };
