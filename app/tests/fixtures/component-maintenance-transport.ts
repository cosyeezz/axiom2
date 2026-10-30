// Test-only transport: NEVER imports the real client transport or falls back to it.
import { useSyncExternalStore } from "react";
import { emptyReaState } from "../../src/shared/rea.js";
import { emptyRtkState, emptyRtkStats } from "../../src/shared/rtk.js";
import { emptyModelProxyState } from "../../src/shared/model-proxy.js";
import { emptyMaintenanceState } from "../../src/shared/maintenance.js";
import { defaultOpenCliSettings } from "../../src/shared/builtin-tools.js";

const emptyOpen = { ready: false, configured: false, revision: "", nodeVersion: "", settings: defaultOpenCliSettings };
const defaults: Record<string, unknown> = { "builtin-tools:opencli": emptyOpen, "builtin-tools:rea": emptyReaState, "builtin-tools:rtk": emptyRtkState, "builtin-tools:model-proxy": emptyModelProxyState, maintenance: emptyMaintenanceState };
let scopes = { ...defaults }, connection = { connected: true, generation: 1 };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const calls: { op: string; params: Record<string, unknown>; requestId?: string }[] = [];
const network: string[] = [];
export function useScope<T>(key: string, fallback: T): T { return useSyncExternalStore(subscribe, () => (scopes[key] ?? fallback) as T); }
export function useConnectionState() { return useSyncExternalStore(subscribe, () => connection); }
export function useConnection() { return useConnectionState().connected ? "已连接（内存夹具）" : "连接已断开"; }
export async function command(op: string, params: Record<string, unknown> = {}, _target: unknown = {}, requestId?: string): Promise<unknown> {
  calls.push({ op, params, requestId });
  if (!connection.connected) throw Error("Fixture disconnected; no queuing or replay");
  if (op === "rtk.stats") return structuredClone(emptyRtkStats);
  const allowed = /^(opencli\.(get|refresh|check|install|uninstall)|rea\.(refresh|check|install|uninstall|engine-check|engine-install|engine-download|engine-open-installer|clearDownloads|engine-uninstall|installSkill|uninstallSkill|installMcp|uninstallMcp)|rtk\.(get|check|install|uninstall|doctor)|modelProxy\.(get|check|install|uninstall))$/;
  if (!allowed.test(op)) throw Error(`Unexpected fixture command: ${op}`);
  const key = op.startsWith("modelProxy.") ? "builtin-tools:model-proxy" : `builtin-tools:${op.split(".")[0]}`;
  return structuredClone(scopes[key]);
}

// Fail closed even if an accidental new dependency tries to create a network client.
globalThis.fetch = (async (input: RequestInfo | URL) => { network.push(`fetch:${String(input)}`); throw Error("Network forbidden in component fixture"); }) as typeof fetch;
globalThis.WebSocket = class { constructor(url: string | URL) { network.push(`websocket:${url}`); throw Error("WebSocket forbidden in component fixture"); } } as unknown as typeof WebSocket;
export const componentMaintenanceFixture = {
  set(values: Record<string, unknown>, connected = true) {
    scopes = { ...defaults, ...values }; calls.length = 0;
    connection = { connected, generation: connection.generation + 1 };
    for (const listener of listeners) listener();
  },
  calls, network,
};
Object.assign(window, { componentMaintenanceFixture });
