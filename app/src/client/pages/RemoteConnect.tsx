import { useEffect, useRef, useState, type ReactNode } from "react";
import { desktopInvoke, remember, stored } from "./desktop-bridge.js";
import { Icon } from "../Icon.js";
function savedTarget() {
  const value = stored("axiom.remote.address");
  try { const url = new URL(value); return { address: `${url.protocol}//${url.hostname}`, port: url.port || (url.protocol === "https:" ? "443" : "80") }; } catch { return { address: value, port: "4317" }; }
}
export default function RemoteConnect({ local, target, disabled, onBusy, onOpen, children }: { local: boolean; target: string; disabled: boolean; onBusy: (busy: boolean) => void; onOpen: (url: string) => void; children: ReactNode }) {
  const [address, setAddress] = useState(() => local ? "127.0.0.1" : target || savedTarget().address);
  const [port, setPort] = useState(() => local ? stored("axiom.local.port", "4317") : target ? "4317" : savedTarget().port);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false), alive = useRef(true);
  useEffect(() => {
    setAddress(local ? "127.0.0.1" : target || savedTarget().address);
    setPort(local ? stored("axiom.local.port", "4317") : target ? "4317" : savedTarget().port);
    setError("");
  }, [target, local]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function connect() {
    if (active.current || disabled) return;
    if (!address.trim() || !/^\d+$/.test(port) || +port < 1 || +port > 65535) { setError("请输入有效地址和 1–65535 范围内的端口。"); return; }
    active.current = true; setConnecting(true); onBusy(true); setError("");
    try {
      const result = await desktopInvoke<{ url: string }>(local ? "axiom_local" : "axiom_remote", local ? { port: +port } : { address: address.trim(), port: +port });
      if (!result || typeof result.url !== "string" || !/^https?:\/\//.test(result.url)) throw Error("目标服务未返回有效连接，请重试。");
      if (alive.current) { if (local) remember("axiom.local.port", port); onOpen(result.url); }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { active.current = false; if (alive.current) setConnecting(false); onBusy(false); }
  }
  return <section className="target-connect" aria-label="连接所选设备">
    <form onSubmit={event => { event.preventDefault(); void connect(); }}>
      <div className="startup-target-row">{children}<button className="connect-primary startup-connect-button" type="submit" aria-label="连接工作台" disabled={disabled || connecting || !address.trim()}><span>{connecting ? "连接中…" : "连接"}</span><Icon name={connecting ? "loader-circle" : "arrow-up-right"} className={connecting ? "startup-spin" : ""} /></button></div>
      <div className="connection-address-row"><label className="connection-field">连接地址<input aria-label={local ? "本地连接地址" : "远程连接地址"} value={address} readOnly={local} onChange={event => { const value = event.target.value; setAddress(value); try { const url = new URL(value.includes("://") ? value : `http://${value}`); if (url.port) setPort(url.port); else if (/:\d+\/?$/.test(value)) setPort(url.protocol === "https:" ? "443" : "80"); } catch {} }} placeholder="100.x.x.x" disabled={connecting} autoComplete="off" spellCheck={false} /></label><label className="connection-field connection-port">端口<input aria-label={local ? "本地端口" : "远程端口"} inputMode="numeric" value={port} onChange={event => setPort(event.target.value)} disabled={connecting} /></label></div>
      {error && <p className="connect-error" role="alert">{error}</p>}
    </form>
    <p className="connect-footnote">{local ? "已有后台或开发服务可直接连接，无需完成下方安装。默认端口 4317。" : "选择设备后点击连接；目标需已启动 Axiom 服务，并登录同一 Tailscale 网络。"}</p>
  </section>;
}
