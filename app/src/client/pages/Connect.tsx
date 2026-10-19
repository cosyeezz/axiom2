import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icon.js";
import DesktopUpdates from "./DesktopUpdates.js";
import { BrandMark } from "../BrandMark.js";
import type { ConnectionHealth } from "../transport.js";
import SetupWizard from "./SetupWizard.js";
import RemoteConnect from "./RemoteConnect.js";
import { desktopInvoke, remember, stored } from "./desktop-bridge.js";
import DeviceSelect from "./DeviceSelect.js";
import { IconButton } from "./StartupControls.js";
import "../styles/connect.css";

type View = "control" | "workbench";
type Service = { desktopView?: View; state: "starting" | "running" | "stopped" | "stopping" | "missing" | "unmanaged"; active: string[]; url?: string; log?: string; message?: string; background?: boolean };
type Action = "status" | "start" | "stop" | "open";
const labels = { starting: "服务正在启动", running: "服务运行中", stopped: "服务已停止", stopping: "服务正在退出", missing: "需要安装服务", unmanaged: "端口已被占用" };
async function invoke(action: Action): Promise<Service> {
  const result = await desktopInvoke<Service>("axiom_service", { action });
  if (!result || !(result.state in labels)) throw Error("服务状态不完整，请重新读取。");
  return { ...result, active: Array.isArray(result.active) ? result.active.filter(item => typeof item === "string") : [] };
}

export default function Connect() {
  const [service, setService] = useState<Service | null>(null);
  const [view, setView] = useState<View>("control");
  const [returning, setReturning] = useState(false);
  const [connection, setConnection] = useState<ConnectionHealth>("checking");
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [device, setDevice] = useState(() => stored("axiom.connection.mode") === "remote" ? "manual" : "local");
  const mode = device === "local" ? "local" : "remote";
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [preparation, setPreparation] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [notice, setNotice] = useState(false);
  const [updateSeen, setUpdateSeen] = useState(false);
  const lastConnection = useRef<ConnectionHealth>("checking");
  useEffect(() => {
    if (view === "workbench" && connection !== "checking" && lastConnection.current !== "checking" && connection !== lastConnection.current) setNotice(true);
    if (connection !== "checking") lastConnection.current = connection;
    if (connection === "connected" && remoteUrl && mode === "remote") remember("axiom.remote.address", remoteUrl);
  }, [connection, view, remoteUrl, mode]);
  useEffect(() => { if (!updateAvailable) setUpdateSeen(false); }, [updateAvailable]);
  const showDot = notice || (updateAvailable && !updateSeen);
  const revision = useRef(0);
  const openButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const pending = useRef<Promise<void> | null>(null);
  const requested = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);

  async function act(action: Action, quiet = false) {
    if (quiet ? pending.current || requested.current : requested.current) return;
    if (!quiet) { requested.current = true; setBusy(action); setError(""); }
    // Status polling has a bounded IPC deadline. Reserve the user action while
    // waiting so a poll cannot discard a confirmed start/stop/open request.
    if (pending.current) await pending.current;
    const observed = revision.current;
    const request = (async () => {
      try {
        const result = await invoke(action);
        setService(result);
        if (observed === revision.current && result.desktopView) setView(result.desktopView);
        if (!quiet) setError("");
      }
      catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    })();
    pending.current = request;
    try { await request; }
    finally {
      if (pending.current === request) pending.current = null;
      if (!quiet) { requested.current = false; setBusy(null); }
    }
  }
  async function showControls() {
    if (returning) return;
    setReturning(true);
    try {
      await desktopInvoke("axiom_controls");
      revision.current++;
      setView("control"); setNotice(false); setUpdateSeen(true);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setReturning(false); }
  }
  useEffect(() => {
    const changed = (event: Event) => {
      const next: unknown = (event as CustomEvent).detail;
      if (next === "control" || next === "workbench") { revision.current++; setView(next); }
    };
    const failed = (event: Event) => { const detail = (event as CustomEvent).detail; if (typeof detail === "string") setError(detail); };
    window.addEventListener("axiom-desktop-error", failed);
    window.addEventListener("axiom-desktop-view", changed);
    return () => { window.removeEventListener("axiom-desktop-view", changed); window.removeEventListener("axiom-desktop-error", failed); };
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
    void act("status", true);
    const timer = window.setInterval(() => { void act("status", true); }, 3000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (confirm) dialog.current?.showModal();
    else if (dialog.current?.open) { dialog.current.close(); stopButton.current?.focus(); }
  }, [confirm]);
  const running = service?.state === "running";
  const blocked = !!busy || updating || installing || remoteBusy;
  const starting = service?.state === "starting";
  const missing = service?.state === "missing";
  const connectionLabel = connection === "connected" ? "后台服务已连接" : connection === "disconnected" ? "后台服务已断开" : "后台服务确认中";
  return (
    <>
    <nav className="desktop-workbench-bar" aria-label="桌面导航" hidden={view !== "workbench"}>
      <div className="desktop-workbench-left">
        <span className="desktop-workbench-brand"><BrandMark size={26} /><span className="desktop-brand-name">AXIOM<span>2</span></span></span>
        <span className="desktop-workbench-status" data-state={connection} role="status" aria-live="polite" aria-label={connectionLabel}>
          <Icon name="link-2" />
          <span>{connectionLabel}</span>
        </span>
      </div>
      {error && <span role="alert" className="desktop-workbench-error" title={error}>{error}</span>}
      <button onClick={() => void showControls()} disabled={returning} aria-label={showDot ? "服务与更新，有待查看的变化" : "服务与更新"}>
        <Icon name="settings-2" />
        <span>服务与更新</span>{showDot && <i className="desktop-update-dot" aria-hidden="true" />}
      </button>
    </nav>
    <main className="connect-page" hidden={view === "workbench"}>
      <header className="connect-header"><span className="connect-brand"><BrandMark size={38} /><span>AXIOM<span className="startup-brand-version">2</span></span></span><span className="connect-local">你的私有工作台</span></header>
      <div className="startup-title"><div><p className="startup-overline">CONNECT YOUR WORKSPACE</p><h1>从这里，继续工作。</h1></div><span className="startup-private"><Icon name="link-2" />仅在你的设备之间</span></div>
      <section className="startup-panel" aria-label="连接与准备">
        <div className="startup-device"><label>连接设备</label><RemoteConnect local={mode === "local"} target={device === "manual" || device === "local" ? "" : device} disabled={remoteBusy || installing || (!!busy && busy !== "status") || updating} onBusy={setRemoteBusy} onOpen={url => { setRemoteUrl(mode === "remote" ? url : ""); revision.current++; setView("workbench"); setConnection("checking"); lastConnection.current = "checking"; }}><DeviceSelect value={device} disabled={remoteBusy || installing || updating || (!!busy && busy !== "status")} onChange={value => { setDevice(value); remember("axiom.connection.mode", value === "local" ? "local" : "remote"); setError(""); }} /></RemoteConnect></div>
        <details className="startup-preparation" open={preparation || installing} onToggle={event => setPreparation(event.currentTarget.open)}><summary>安装与准备<span>安装命令 · 自动安装 · 手动下载</span><Icon name="chevron-down" /></summary>
        <SetupWizard remote={mode === "remote"} service={service} blocked={!!busy || updating || remoteBusy} onBusy={setInstalling} onComplete={() => void act("status")}>
        {mode === "remote" ? <section><div className="startup-content-heading"><h2>连接远程工作台</h2></div><p className="startup-description">在上方选择设备、核对地址和端口，点击右侧「连接」。设备在线不代表 Axiom 服务已经启动。</p><p className="connect-footnote">远程连接无需在本机安装 Node.js 或 Axiom 后台。</p></section> : <section className="local-connect" aria-label="本地服务控制">
          <div className="startup-content-heading"><div><span className="startup-overline">03 / CONNECT</span><h2>{updating ? "正在更新服务…" : busy === "start" ? "正在启动服务…" : busy === "stop" ? "正在关闭服务…" : service ? labels[service.state] : error ? "服务状态待核实" : "正在检查服务…"}</h2></div><IconButton label="刷新服务状态" icon="refresh-cw" spinning={busy === "status"} disabled={!!busy} onClick={() => void act("status")} /></div>
          <p className="startup-description">{updating ? "更新完成后即可打开工作台。" : busy === "start" ? "首次启动可能需要一些时间，请稍候。" : busy === "stop" ? "正在结束任务并保存状态，请稍候。" : !service ? "正在读取后台服务状态。" : starting ? "正在准备后台服务，请等待就绪。" : running ? "连接已就绪，项目、会话和任务都在这里。" : missing ? "可在上方直接连接已有服务，或先安装可管理的后台。" : service.state === "stopping" ? service.message || "正在结束任务，请等待服务退出。" : service.state === "unmanaged" ? "请处理端口占用后再启动。" : "后台独立运行，关闭客户端后任务仍会继续。"}</p>
          <dl className="connect-details"><div><dt>连接地址</dt><dd>{service?.url || "http://127.0.0.1:4317/"}</dd></div><div><dt>运行中的会话</dt><dd>{running ? `${service.active.length}${service.active.length >= 20 ? "+" : ""}` : "—"}</dd></div></dl>
          {service?.message && <p className="connect-message">{service.message}</p>}
          <div className="startup-step-actions">
            {running ? <><button ref={openButton} className="startup-icon-button startup-open" aria-label="打开工作台" data-tooltip="打开工作台" disabled={blocked} onClick={() => void act("open")}><Icon name="arrow-up-right" /></button><button ref={stopButton} className="startup-icon-button" aria-label="关闭后台服务" data-tooltip="关闭后台服务" disabled={blocked} onClick={() => setConfirm(true)}><Icon name="power" /></button></> : starting ? <IconButton label="关闭后台服务" icon="power" disabled={blocked} onClick={() => setConfirm(true)} /> : <button className="connect-primary" disabled={blocked || !service || service.state !== "stopped"} onClick={() => void act("start")}>{busy === "start" ? "正在启动…" : "启动后台服务"}<Icon name="arrow-right" /></button>}
          </div>
          <p className="connect-footnote">关闭服务会停止正在运行的任务。{running && service.background === false ? "当前服务由终端启动。" : "不会随系统登录自动启动。"}</p>
        </section>}
        </SetupWizard>
        </details>
        {error && <p className="connect-error startup-global-error" role="alert">{error}<IconButton label="重新读取服务状态" icon="refresh-cw" disabled={!!busy} onClick={() => void act("status")} /></p>}
        {mode === "local" && service && service.state !== "missing" && <details className="startup-maintenance"><summary>服务与更新<Icon name="chevron-down" /></summary><DesktopUpdates service={service} serviceBusy={!!busy || installing || remoteBusy} onBusyChange={setUpdating} onAvailableChange={setUpdateAvailable} onServiceChange={() => void act("status")} />{service.log && <p className="connect-log">服务日志：<code>{service.log}</code></p>}</details>}
      </section>
      <footer className="connect-footer"><span>文件和任务留在你的电脑上</span><span>AXIOM 2 · DESKTOP</span></footer>
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
