import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icon.js";
import type { ConnectionHealth } from "../transport.js";
import { validBackendUpdate, newerBackendVersion, type BackendUpdateAction, type BackendUpdateReply } from "../../shared/backend-updates.js";
import { desktopInvoke } from "./desktop-bridge.js";
import type { SystemNotice } from "./SystemNotification.js";

type NativeUpdateReply = BackendUpdateReply & { sourceOrigin: string };
const localBackend = (origin: string) => {
  try { const url = new URL(origin); return url.protocol === "http:" && url.port === "4317" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname); }
  catch { return false; }
};
async function invoke(action: BackendUpdateAction, version?: string): Promise<NativeUpdateReply> {
  const result = await desktopInvoke<unknown>("axiom_backend_updates", { action, version: version ?? null }, action === "check" ? 25_000 : 4000);
  if (!validBackendUpdate(result)) throw Error("版本通知响应不完整，请通过服务与更新页面检查。");
  const sourceOrigin = (result as BackendUpdateReply & { sourceOrigin?: unknown }).sourceOrigin;
  if (typeof sourceOrigin !== "string") throw Error("未确认版本通知来自哪个后台，请通过服务与更新页面检查。");
  return { ...result, sourceOrigin };
}
// Only the update source owns checking, receipts and installation admission.
// The shared notification renderer knows none of these backend-specific rules.
export function useBackendUpdateNotification({ active, connection, target, canUpdate, onUpdate, onError }: {
  active: boolean; connection: ConnectionHealth; target: string; canUpdate: boolean;
  onUpdate: (version: string, runningVersion: string | null) => Promise<void>; onError: (message: string) => void;
}): SystemNotice | null {
  const [notice, setNotice] = useState<{ version: string; runningVersion: string | null; sourceOrigin: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false), epoch = useRef(0);
  const callbacks = useRef({ onUpdate, onError }); callbacks.current = { onUpdate, onError };
  useEffect(() => { ++epoch.current; setNotice(null); }, [target]);
  useEffect(() => {
    if (!active || connection !== "connected") return;
    let cancelled = false, timer: number | undefined;
    const observed = epoch.current;
    const poll = async () => {
      if (inFlight.current) { timer = window.setTimeout(() => void poll(), 1000); return; }
      inFlight.current = true;
      try {
        const state = await invoke("get");
        if (cancelled || epoch.current !== observed) return;
        setNotice(current => current && current.sourceOrigin === state.sourceOrigin && state.latest?.version === current.version && (!state.runningVersion || newerBackendVersion(current.version, state.runningVersion)) ? current : null);
        if (state.pending && state.latest) {
          const claimed = await invoke("present", state.latest.version);
          if (!cancelled && epoch.current === observed && claimed.notice === state.latest.version) setNotice({ version: claimed.notice, runningVersion: claimed.runningVersion, sourceOrigin: claimed.sourceOrigin });
        }
      } catch { /* Old backends/clients and disconnects must not masquerade as "latest". */ }
      finally { inFlight.current = false; if (!cancelled) timer = window.setTimeout(() => void poll(), 10_000); }
    };
    void poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [active, connection, target]);
  async function act(action: "dismiss" | "check") {
    if (!notice || busy || inFlight.current || action === "check" && (!canUpdate || !localBackend(notice.sourceOrigin))) return;
    const observed = epoch.current, version = notice.version;
    inFlight.current = true; setBusy(true);
    try {
      const result = await invoke(action, action === "dismiss" ? version : undefined);
      if (epoch.current !== observed) return;
      if (action === "dismiss") setNotice(null);
      else {
        if (result.error) throw Error(result.error);
        if (result.sourceOrigin !== notice.sourceOrigin || !localBackend(result.sourceOrigin)) throw Error("后台连接已变化，请在后台所在设备更新；未提交本机安装。");
        if (!result.available || !result.latest) { setNotice(null); callbacks.current.onError("当前后台已是最新版本。"); return; }
        setNotice({ version: result.latest.version, runningVersion: result.runningVersion, sourceOrigin: result.sourceOrigin });
        await callbacks.current.onUpdate(result.latest.version, result.runningVersion);
      }
    } catch (error) { if (epoch.current === observed) callbacks.current.onError(error instanceof Error ? error.message : "版本通知操作失败，请重试。"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (!active || connection !== "connected" || !notice) return null;
  const allowed = canUpdate && localBackend(notice.sourceOrigin);
  return {
    id: "update", icon: <Icon name="download" className="system-notification-icon" />,
    message: <><span className="system-notification-context">后台有新版本 </span><strong>v{notice.version}</strong></>,
    action: { label: busy ? "正在检查…" : "检查并更新", className: "system-notification-update", disabled: busy || !allowed,
      title: !allowed ? "请在后台所在设备的服务与更新页面操作，不能更新其他设备或未受管理的服务。" : undefined, onClick: () => void act("check") },
    dismiss: { label: `关闭 v${notice.version} 更新通知`, disabled: busy, onClick: () => void act("dismiss") },
  };
}
