import { useEffect, useRef, useState } from "react";
import DesktopUpdates from "./DesktopUpdates.js";
import type { ConnectionHealth } from "../transport.js";
import "../styles/connect.css";

type View = "control" | "workbench";
type Service = { desktopView?: View; state: "starting" | "running" | "stopped" | "stopping" | "missing" | "unmanaged"; active: string[]; url?: string; log?: string; message?: string; background?: boolean };
type Action = "status" | "start" | "stop" | "open";
const labels = { starting: "服务正在启动", running: "服务运行中", stopped: "服务已停止", stopping: "服务正在退出", missing: "需要安装服务", unmanaged: "端口已被占用" };
function invoke(action: Action): Promise<Service> {
  const bridge = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (command: string, args: object) => Promise<Service> } }).__TAURI_INTERNALS__;
  if (!bridge) return Promise.reject(new Error("服务控制需要在 Axiom2 桌面客户端中使用。浏览器用户可以在终端运行 axiom2 start。"));
  return bridge.invoke("axiom_service", { action });
}

export default function Connect() {
  const [service, setService] = useState<Service | null>(null);
  const [view, setView] = useState<View>("control");
  const [returning, setReturning] = useState(false);
  const [connection, setConnection] = useState<ConnectionHealth>("checking");
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const revision = useRef(0);
  const openButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const pending = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const command = /Win/i.test(navigator.platform)
    ? "irm https://raw.githubusercontent.com/cosyeezz/axiom2/master/install.ps1 | iex"
    : "curl -fsSL https://raw.githubusercontent.com/cosyeezz/axiom2/master/install.sh | sh";

  async function act(action: Action, quiet = false) {
    if (pending.current && quiet) return;
    if (!quiet) { setBusy(action); setError(""); }
    while (pending.current) await new Promise((resolve) => window.setTimeout(resolve, 80));
    pending.current = true;
    const observed = revision.current;
    try {
      const result = await invoke(action);
      setService(result);
      if (observed === revision.current && result.desktopView) setView(result.desktopView);
      if (!quiet) setError("");
    }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { pending.current = false; if (!quiet) setBusy(null); }
  }
  async function showControls() {
    if (returning) return;
    setReturning(true);
    try {
      const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<void> } }).__TAURI_INTERNALS__;
      await bridge.invoke("axiom_controls");
      revision.current++;
      setView("control");
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setReturning(false); }
  }
  useEffect(() => {
    const changed = (event: Event) => {
      const next: unknown = (event as CustomEvent).detail;
      if (next === "control" || next === "workbench") { revision.current++; setView(next); }
    };
    window.addEventListener("axiom-desktop-view", changed);
    return () => window.removeEventListener("axiom-desktop-view", changed);
  }, []);
  useEffect(() => { if (view === "control") openButton.current?.focus(); }, [view]);
  useEffect(() => {
    setConnection("checking");
    if (view !== "workbench") return;
    let cancelled = false, inFlight = false, acceptedAt = 0;
    let timer: number | undefined;
    const expiry = window.setInterval(() => {
      const age = Date.now() - acceptedAt;
      if (age < 0 || age >= 3000) setConnection("checking");
    }, 500);
    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      const requestedAt = Date.now();
      let deadline: number | undefined;
      try {
        const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: (name: string) => Promise<unknown> } }).__TAURI_INTERNALS__;
        const state = await Promise.race([
          bridge.invoke("axiom_connection"),
          new Promise<never>((_, reject) => { deadline = window.setTimeout(() => reject(Error("连接检测超时")), 2000); }),
        ]);
        if (!cancelled) {
          const age = Date.now() - requestedAt;
          acceptedAt = Date.now();
          setConnection(age >= 0 && age < 2000 && (state === "connected" || state === "disconnected") ? state : "checking");
        }
      } catch { if (!cancelled) setConnection("checking"); }
      finally {
        window.clearTimeout(deadline);
        inFlight = false;
        if (!cancelled) timer = window.setTimeout(() => void poll(), 1000);
      }
    };
    const resume = () => { setConnection("checking"); window.clearTimeout(timer); void poll(); };
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    void poll();
    return () => { cancelled = true; window.clearTimeout(timer); window.clearInterval(expiry); window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); };
  }, [view]);
  useEffect(() => {
    void act("status");
    const timer = window.setInterval(() => { void act("status", true); }, 3000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (confirm) dialog.current?.showModal();
    else if (dialog.current?.open) { dialog.current.close(); stopButton.current?.focus(); }
  }, [confirm]);
  const running = service?.state === "running";
  const blocked = !!busy || updating;
  const starting = service?.state === "starting";
  const missing = service?.state === "missing";
  const connectionLabel = connection === "connected" ? "后台服务已连接" : connection === "disconnected" ? "后台服务已断开" : "后台服务确认中";
  return (
    <>
    <nav className="desktop-workbench-bar" aria-label="桌面导航" hidden={view !== "workbench"}>
      <div className="desktop-workbench-left">
        <span className="desktop-workbench-brand">AXIOM<span>2</span></span>
        <span className="desktop-workbench-status" data-state={connection} role="status" aria-live="polite" aria-label={connectionLabel}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.52" d="M1.88 12.21q2.32.02 4.62-.36q1.21-3.49 2.99-6.73q2.26 7.09 5.12 13.96q1.44-3.57 2.8-7.17q2.22.15 4.44.31" /></svg>
          <span>{connectionLabel}</span>
        </span>
      </div>
      {error && <span role="alert" className="desktop-workbench-error" title={error}>{error}</span>}
      <button onClick={() => void showControls()} disabled={!!busy || returning} aria-label={updateAvailable ? "服务与更新，有可用更新" : "服务与更新"}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h8m4 0h4M4 17h3m4 0h9" /><circle cx="14" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></svg>
        <span>服务与更新</span>{updateAvailable && <i className="desktop-update-dot" aria-hidden="true" />}
      </button>
    </nav>
    <main className="connect-page" hidden={view === "workbench"}>
      <header className="connect-header"><a href="#" aria-label="Axiom2 首页" className="connect-brand">A<span>2</span></a><span>AXIOM2 <i>/</i> DESKTOP</span><span className="connect-local">本机 · 私有工作台</span></header>
      <div className="connect-layout">
        <section className="connect-intro">
          <p className="connect-eyebrow">你的工作，从这里开始</p>
          <h1>就绪之后，<br /><span>专注创造。</span></h1>
          <p className="connect-lead">在这里管理本机服务。启动后打开工作台，继续你的项目、会话与任务。</p>
          <div className="connect-note"><span aria-hidden="true">↗</span><p>后台服务独立运行。<br /><small>关闭客户端，任务仍会继续。</small></p></div>
        </section>
        <section className="connect-panel" aria-label="本地服务控制">
          <div className="connect-panel-top"><span>本地服务</span><button className="connect-refresh" onClick={() => void act("status")} disabled={!!busy}>刷新状态 <span aria-hidden="true">↻</span></button></div>
          <div className="connect-status" role="status" aria-live="polite"><span className={`connect-dot ${running ? "is-running" : ""}`} /><h2>{updating ? "正在更新服务…" : busy === "start" ? "正在启动服务…" : busy === "stop" ? "正在关闭服务…" : service ? labels[service.state] : "正在检查服务…"}</h2></div>
          <p className="connect-status-detail">{updating ? "可在下方查看更新进度，完成后再打开工作台。" : busy === "start" ? "首次启动可能需要一些时间，请稍候。" : busy === "stop" ? "正在结束任务并保存状态，请稍候。" : starting ? "正在准备后台服务，可以等待就绪或关闭服务。" : running ? "连接已就绪，可以打开工作台。" : missing ? "安装一次，即可在客户端启动和关闭服务。" : service?.state === "stopping" ? service.message || "正在结束任务，请等待服务退出。" : service?.state === "unmanaged" ? "请处理端口占用后再启动。" : "服务尚未启动，点击下方按钮即可启动。"}</p>
          <dl className="connect-details"><div><dt>连接地址</dt><dd>{service?.url || "http://127.0.0.1:4317/"}</dd></div><div><dt>运行中的会话</dt><dd>{running ? `${service.active.length}${service.active.length >= 20 ? "+" : ""}` : "—"}</dd></div></dl>
          {service?.message && <p className="connect-message">{service.message}</p>}
          {error && <p className="connect-error" role="alert">{error}</p>}
          <div className="connect-actions">
            {starting ? <button ref={stopButton} className="connect-secondary" disabled={blocked} onClick={() => setConfirm(true)}>关闭后台服务</button> : running ? <><button ref={openButton} className="connect-primary" disabled={blocked} onClick={() => void act("open")}>打开工作台 <span aria-hidden="true">↗</span></button><button ref={stopButton} className="connect-secondary" disabled={blocked} onClick={() => setConfirm(true)}>关闭后台服务</button></>
              : <button className="connect-primary" disabled={blocked || !service || service.state !== "stopped"} onClick={() => void act("start")}>{busy === "start" ? "正在启动…" : "启动后台服务"}<span aria-hidden="true">→</span></button>}
          </div>
          <p className="connect-footnote">关闭服务会停止正在运行的任务。{running && service.background === false ? "当前服务由终端启动。" : "不会随系统登录自动启动。"}</p>
        </section>
      </div>
      <DesktopUpdates service={service} serviceBusy={!!busy} onBusyChange={setUpdating} onAvailableChange={setUpdateAvailable} onServiceChange={() => void act("status")} />
      <details className="connect-install" open={missing || undefined}>
        <summary>首次安装 / 手动修复 <span>一行命令安装</span></summary>
        <p>先安装 Node.js 22.19.0 或更新版本，再在终端运行以下命令。更新前先关闭服务；安装完成后点击“刷新状态”。</p>
        <div className="connect-command"><code>{command}</code><button onClick={() => { void navigator.clipboard.writeText(command).then(() => setCopied(true), () => setError("复制失败，请手动复制安装命令。")); }}>{copied ? "已复制" : "复制命令"}</button></div>
        {service?.log && <p className="connect-log">服务日志：<code>{service.log}</code></p>}
      </details>
      <footer className="connect-footer"><span>文件和任务留在你的电脑上</span><span>Axiom2 / 本地服务控制</span></footer>
      <dialog ref={dialog} className="connect-dialog" onCancel={() => setConfirm(false)} onClose={() => setConfirm(false)} aria-labelledby="stop-title">
        <h2 id="stop-title">关闭后台服务？</h2>
        <p>{service?.active.length ? `当前有 ${service.active.length}${service.active.length >= 20 ? "+" : ""} 个会话正在执行任务，关闭服务会中断这些任务。` : "关闭后将返回服务控制页，尚未结束的任务将被停止。"}项目和会话记录会保留。</p>
        {!!service?.active.length && <ul>{service.active.map((title, index) => <li key={index}>{title || "未命名会话"}</li>)}</ul>}
        <div className="connect-dialog-actions"><button className="connect-secondary" autoFocus onClick={() => setConfirm(false)}>继续运行</button><button className="connect-danger" onClick={() => { setConfirm(false); void act("stop"); }}>确认关闭服务</button></div>
      </dialog>
    </main>
    </>
  );
}
