import { useEffect, useRef, useState } from "react";
import { ThemeToggle } from "../theme.js";
import { Icon } from "../Icon.js";
import DesktopUpdates from "./DesktopUpdates.js";
import { BrandMark } from "../BrandMark.js";
import type { ConnectionHealth } from "../transport.js";
import SetupWizard, { type PreparationDetection } from "./SetupWizard.js";
import { ConnectionIcon } from "./ConnectionIcon.js";
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
  const [detection, setDetection] = useState<PreparationDetection>({ environment: null, checking: true, failed: false });
  const [connectionPort, setConnectionPort] = useState("4317");
  const [serviceUncertain, setServiceUncertain] = useState(false);
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
        setService(result); setServiceUncertain(false);
        if (observed === revision.current && result.desktopView) setView(result.desktopView);
        if (!quiet) setError("");
      }
      catch (err) { setServiceUncertain(true); setError(err instanceof Error ? err.message : String(err)); }
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
  const serviceState = serviceUncertain ? "unknown" : service?.state || "checking";
  const serviceLabel = updating ? "更新中" : busy === "start" ? "启动中" : busy === "stop" ? "关闭中" : serviceState === "unknown" ? "待核实" : serviceState === "checking" ? "检查中" : ({ running: "运行中", stopped: "已停止", starting: "启动中", stopping: "退出中", missing: "未安装", unmanaged: "端口占用" } as const)[serviceState];
  const detectionUnknown = detection.checking || detection.failed || !detection.environment;
  const preparationTags = [{ name: "Node.js", ready: detection.environment?.nodeReady }, { name: "npm", ready: detection.environment?.nodeReady }, { name: "Tailscale", ready: detection.environment?.tailscale }];
  const connectionLabel = connection === "connected" ? "后台服务已连接" : connection === "disconnected" ? "后台服务已断开" : "后台服务确认中";
  return (
    <>
    <nav className="desktop-workbench-bar" aria-label="桌面导航" hidden={view !== "workbench"}>
      <div className="desktop-workbench-left">
        <span className="desktop-workbench-status" data-state={connection} role="status" aria-live="polite" aria-label={connectionLabel}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.52" d="M1.88 12.21q2.32.02 4.62-.36q1.21-3.49 2.99-6.73q2.26 7.09 5.12 13.96q1.44-3.57 2.8-7.17q2.22.15 4.44.31" /></svg>
          <span>{connectionLabel}</span>
        </span>
      </div>
      {error && <span role="alert" className="desktop-workbench-error" title={error}>{error}</span>}
      <div className="desktop-workbench-actions">
      <ThemeToggle />
      <button onClick={() => void showControls()} disabled={returning} aria-label={showDot ? "服务与更新，有待查看的变化" : "服务与更新"}>
        <Icon name="sliders-horizontal" />
        <span>服务与更新</span>{showDot && <i className="desktop-update-dot" aria-hidden="true" />}
      </button>
      </div>
    </nav>
    <main className="connect-page" hidden={view === "workbench"}>
      <header className="connect-header"><span className="connect-brand"><BrandMark size={31} /><span>AXIOM<span className="startup-brand-version">2</span></span></span><span className="connect-header-actions"><span className="connect-local">你的私有工作台</span><ThemeToggle /></span></header>
      <div className="startup-title"><h1><span>就绪之后，</span><span>专注创造。</span></h1><p>连接你的设备，继续项目、会话与任务。</p></div>
      <section className="startup-panel" aria-label="连接与准备">
        <div className="startup-device">
          <RemoteConnect local={mode === "local"} target={device === "manual" || device === "local" ? "" : device} disabled={remoteBusy || installing || (!!busy && busy !== "status") || updating} onBusy={setRemoteBusy} onPortChange={setConnectionPort} onOpen={url => { setRemoteUrl(mode === "remote" ? url : ""); revision.current++; setView("workbench"); setConnection("checking"); lastConnection.current = "checking"; }}><DeviceSelect value={device} disabled={remoteBusy || installing || updating || (!!busy && busy !== "status")} onChange={value => { setDevice(value); remember("axiom.connection.mode", value === "local" ? "local" : "remote"); setError(""); }} /></RemoteConnect>
          {mode === "local" && <section className="connection-service" aria-label="本地服务控制">
            <div className="connection-service-row">
              <div className="connection-service-copy"><div className="connection-service-heading">本地服务<span className="connection-status-tag" data-state={serviceState} role="status"><Icon name={serviceState === "running" && !busy && !updating ? "circle-check" : serviceState === "unknown" ? "circle-help" : starting || busy || updating || serviceState === "checking" ? "loader-circle" : "circle-help"} className={starting || busy || updating || serviceState === "checking" ? "startup-spin" : ""} />{serviceLabel}</span></div>
                <p className="connection-service-detail">{(service?.url || "http://127.0.0.1:4317/").replace(/^https?:\/\//, "").replace(/\/$/, "")}{running && !serviceUncertain && <span> · {service.active.length}{service.active.length >= 20 ? "+" : ""} 个运行中的会话</span>}</p>
              </div>
              <div className="connection-service-actions"><button className="connection-text-button" aria-label="刷新服务状态" disabled={!!busy || updating} onClick={() => void act("status")}><Icon name="refresh-cw" className={busy === "status" ? "startup-spin" : ""} /><span>检查状态</span></button><span className="connection-action-divider" aria-hidden="true" />
                {running || starting ? <button ref={stopButton} className="connection-text-button connection-stop" aria-label="关闭后台服务" disabled={blocked || serviceUncertain} onClick={() => setConfirm(true)}><Icon name="power" /><span>{starting ? "取消启动" : "关闭服务"}</span></button> : missing ? <button className="connection-text-button" disabled={blocked} onClick={() => setPreparation(true)}><Icon name="download" /><span>安装服务</span></button> : <button className="connection-text-button" aria-label="启动后台服务" disabled={blocked || serviceUncertain || service?.state !== "stopped"} onClick={() => void act("start")}><Icon name="power" /><span>启动服务</span></button>}
              </div>
            </div>
            {connectionPort !== "4317" && <p className="connection-service-hint">上方连接端口为 {connectionPort || "—"}；这里管理的本地后台使用 4317 端口。</p>}
            {service?.message && <p className="connect-message">{service.message}</p>}
          </section>}
        </div>
        {mode === "local" && <details className="startup-maintenance"><summary><Icon name="sliders-horizontal" />版本与更新 · Pi 引擎<span>{updateAvailable ? "发现新版本" : "按需查看"}</span><Icon name="chevron-down" /></summary>{!service ? <p className="connect-update-detail">正在读取本地服务状态…</p> : <DesktopUpdates service={service} serviceBusy={!!busy || installing || remoteBusy} onBusyChange={setUpdating} onAvailableChange={setUpdateAvailable} onServiceChange={() => void act("status")} />}{service?.log && <p className="connect-log">服务日志：<code>{service.log}</code></p>}</details>}
        <details className="startup-preparation" open={preparation || installing} onToggle={event => setPreparation(event.currentTarget.open)}><summary><ConnectionIcon name="package" />安装与准备<span className="preparation-tags">{preparationTags.map(tag => <span key={tag.name} className="preparation-tag" data-state={detectionUnknown ? "unknown" : tag.ready ? "ready" : "missing"} aria-label={tag.name + (detection.checking ? "：检测中" : detectionUnknown ? "：待核实" : tag.ready ? "：已检测到" : "：未就绪")}><Icon name={detectionUnknown ? "circle-help" : tag.ready ? "check" : "minus"} />{tag.name}</span>)}</span><Icon name="chevron-down" /></summary>
          <SetupWizard remote={mode === "remote"} service={service} blocked={!!busy || updating || remoteBusy} onBusy={setInstalling} onComplete={() => void act("status")} onDetection={setDetection}>
            <section><div className="startup-content-heading"><h2>连接工作台</h2></div><p className="startup-description">在上方选择设备、核对端口，点击「连接」。已有后台或开发服务无需完成安装步骤即可直接连接。</p><p className="connect-footnote">{mode === "remote" ? "远程连接无需在本机安装 Node.js 或 Axiom 后台。设备在线不代表目标服务已经启动。" : "本地服务的状态、检查与启停位于连接区下方。关闭服务会停止正在运行的任务，不会随系统登录自动启动。"}</p>{mode === "local" && running && <div className="startup-step-actions"><button ref={openButton} className="connect-secondary" disabled={blocked || serviceUncertain} onClick={() => void act("open")}>打开工作台</button></div>}</section>
          </SetupWizard>
        </details>
        {error && <p className="connect-error startup-global-error" role="alert">{error}<IconButton label="重新读取服务状态" icon="refresh-cw" disabled={!!busy} onClick={() => void act("status")} /></p>}
      </section>
      <footer className="connect-footer"><span><ConnectionIcon name="privacy" />文件和任务留在你的电脑上</span><span>关闭客户端不会停止服务</span></footer>
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
