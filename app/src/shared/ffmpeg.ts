export interface FfmpegState {
  revision: string;
  platform: string;
  supported: boolean;
  managedFiles?: boolean;
  version?: string;
  directory?: string;
  error?: string;
  latest?: string;
  diagnostic?: { text: string; at: number };
  job?: { id: string; kind: "check" | "install" | "doctor" | "uninstall"; running: boolean; message: string; error?: string };
}
export const emptyFfmpegState: FfmpegState = { revision: "", platform: "", supported: false };
