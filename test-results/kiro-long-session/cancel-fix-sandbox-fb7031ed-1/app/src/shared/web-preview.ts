export interface WebPreviewDescription {
  root: string; entry?: string; scripts: { name: string; command: string }[]; revision: string;
}
export interface WebPreviewState {
  id: string; urls: string[]; mode: "page" | "project"; network: boolean;
  status: "running" | "exited"; log: string; expires: number;
}
