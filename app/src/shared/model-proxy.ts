// Maximum UTF-8 bytes in an imported source, before JSON transport escaping.
export const proxySourceLimit = 2_000_000;
export type ProxyKernel = "xray" | "mihomo";
export type ProxyProfile = { id: string; name: string; kernel: ProxyKernel; node: string };
export type ProxyInstallation = { version: string; directory: string };
export type ProxyStatus = { status: "starting" | "running" | "stopped" | "error"; message?: string };
export type ProxyNode = { name: string; type: string };
export type ProxyInspection = { id: string; kernel?: ProxyKernel; nodes: ProxyNode[] };
export type ModelProxyState = {
  revision: string; platform: string; supported: boolean;
  installations: Partial<Record<ProxyKernel, ProxyInstallation>>;
  latest: Partial<Record<ProxyKernel, string>>;
  profiles: (ProxyProfile & ProxyStatus)[];
  bindings: Record<string, string>;
  job?: { id: string; running: boolean; message: string; error?: string };
  inspection?: ProxyInspection;
  error?: string;
};
export const emptyModelProxyState: ModelProxyState = { revision: "", platform: "", supported: false, installations: {}, latest: {}, profiles: [], bindings: {} };
