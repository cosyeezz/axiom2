import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { desktopInvoke, isDesktopResponsePending, remember, stored } from "./desktop-bridge.js";
import { Icon } from "../Icon.js";
import { ConnectionIcon } from "./ConnectionIcon.js";
function savedTarget() {
  const value = stored("axiom.remote.address");
  try { const url = new URL(value); return { address: `${url.protocol}//${url.hostname}`, port: url.port || (url.protocol === "https:" ? "443" : "80") }; } catch { return { address: value, port: "4317" }; }
}
export type ConnectionControls = { connect: () => void };
export default function RemoteConnect({ local, target, disabled, onBusy, onOpen, onPortChange, beforeConnect, primaryAction, controls, children }: { local: boolean; target: string; disabled: boolean; onBusy: (busy: boolean) => void; onOpen: (url: string) => void; onPortChange: (port: string) => void; beforeConnect?: () => Promise<void>; primaryAction?: ReactNode; controls?: Ref<ConnectionControls>; children: ReactNode }) {
  const [address, setAddress] = useState(() => local ? "127.0.0.1" : target || savedTarget().address);
  const [port, setPort] = useState(() => local ? stored("axiom.local.port", "4317") : target ? "4317" : savedTarget().port);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const active = useRef(false), alive = useRef(true), epoch = useRef(0);
  const key = local ? "local" : target || "manual";
  const previous = useRef(key), drafts = useRef(new Map<string, { address: string; port: string }>());
  const draft = useRef({ address, port }); draft.current = { address, port };
  useEffect(() => {
    drafts.current.set(previous.current, draft.current); previous.current = key;
    const saved = drafts.current.get(key);
    setAddress(saved?.address ?? (local ? "127.0.0.1" : target || savedTarget().address));
    setPort(saved?.port ?? (local ? stored("axiom.local.port", "4317") : target ? "4317" : savedTarget().port));
    ++epoch.current; active.current = false; setConnecting(false); onBusy(false); setError(""); setUncertain(false);
  }, [target, local]);
  useEffect(() => { onPortChange(port); }, [port, onPortChange]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function connect() {
    if (active.current || disabled) return;
    if (!address.trim() || !/^\d+$/.test(port) || +port < 1 || +port > 65535) { setError("请输入有效地址和 1–65535 范围内的端口。"); return; }
    const observed = ++epoch.current;
    const current = () => alive.current && observed === epoch.current;
    active.current = true; setConnecting(true); onBusy(true); setError(""); setUncertain(false);
    try {
      // The native controls request invalidates any old workbench open, not just its JS reply.
      await beforeConnect?.();
      if (!current()) return;
      const result = await desktopInvoke<{ url: string }>(local ? "axiom_local" : "axiom_remote", local ? { port: +port } : { address: address.trim(), port: +port });
      if (!result || typeof result.url !== "string" || !/^https?:\/\//.test(result.url)) throw Error("目标服务未返回有效连接，请重试。");
      if (current()) { if (local) remember("axiom.local.port", port); onOpen(result.url); }
    } catch (cause) { if (current()) { setUncertain(isDesktopResponsePending(cause)); setError(cause instanceof Error ? cause.message : String(cause)); } }
    finally { if (current()) { active.current = false; setConnecting(false); onBusy(false); } }
  }
  useImperativeHandle(controls, () => ({ connect: () => { void connect(); } }));
  return <section className="target-connect" aria-label="连接所选设备">
    <form onSubmit={event => { event.preventDefault(); void connect(); }}>
      <div className="startup-target-row">
        <div className="connection-device-field"><span className="connection-label">连接设备</span>{children}</div>
        <div className="connection-actions"><label className="connection-field connection-port">端口<input aria-label={local ? "本地端口" : "远程端口"} inputMode="numeric" value={port} onChange={event => setPort(event.target.value)} disabled={disabled || connecting} /></label>
          <div className="connection-submit"><button className="connect-primary startup-connect-button" type="submit" aria-label="连接工作台" disabled={disabled || connecting || !address.trim()}>{connecting ? <Icon name="loader-circle" className="startup-spin" /> : <ConnectionIcon name="plug" />}<span>{connecting ? "连接中…" : "连接"}</span></button></div>
        </div>
      </div>
      {!local && !target && <div className="connection-address-row"><label className="connection-field">连接地址<input aria-label="远程连接地址" value={address} onChange={event => { const value = event.target.value; setAddress(value); try { const url = new URL(value.includes("://") ? value : `http://${value}`); if (url.port) setPort(url.port); else if (/:\d+\/?$/.test(value)) setPort(url.protocol === "https:" ? "443" : "80"); } catch {} }} placeholder="100.x.x.x" disabled={disabled || connecting} autoComplete="off" spellCheck={false} /></label></div>}
      {primaryAction}
      {error && <p className={uncertain ? "connect-message" : "connect-error"} role={uncertain ? "status" : "alert"}>{error}</p>}
    </form>
    {!local && <p className="connect-footnote">设备在线仅表示网络可达；点击连接后验证目标 Axiom 服务。</p>}
  </section>;
}
