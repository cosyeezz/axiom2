import { useEffect, useRef, useState } from "react";
import { ThemeToggle } from "../theme.js";
import { Icon } from "../Icon.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import DesktopUpdates, { type DesktopUpdateControls } from "./DesktopUpdates.js";
import SystemNotifications, { type SystemNotice } from "./SystemNotification.js";
import { useBackendUpdateNotification } from "./backend-update-notification.js";
import DesktopEnvironment from "./DesktopEnvironment.js";
import { BrandMark } from "../BrandMark.js";
import type { ConnectionHealth } from "../transport.js";
import SetupWizard, { type PreparationDetection, type SetupControls } from "./SetupWizard.js";
import { ConnectionIcon } from "./ConnectionIcon.js";
import RemoteConnect, { type ConnectionControls } from "./RemoteConnect.js";
import InstallProgress from "./InstallProgress.js";
import { DESKTOP_RESPONSE_TIMEOUT_MESSAGE, desktopInvoke, isDesktopResponsePending, remember, stored } from "./desktop-bridge.js";
import DeviceSelect from "./DeviceSelect.js";
import { IconButton } from "./StartupControls.js";
import "../styles/connect.css";
import "../styles/confirmation-inline.css";
import "../styles/process-motion.css";
import "../styles/connect-layout.css";

type View = "control" | "workbench";
type Service = { artifact?: { download: { state: "verified" | "absent" | "unknown" }; installation: { state: "verified" | "absent" | "unknown"; version?: string } }; desktopView?: View; state: "starting" | "running" | "stopped" | "stopping" | "missing" | "unmanaged"; active: string[]; url?: string; log?: string; message?: string; background?: boolean };
type Action = "status" | "start" | "stop" | "open";
const labels = { starting: "服务正在启动", running: "服务运行中", stopped: "服务已停止", stopping: "服务正在退出", missing: "需要安装服务", unmanaged: "端口已被占用" };
async function invoke(action: Action): Promise<Service> {
  const result = await desktopInvoke<Service>("axiom_service", { action });
  if (!result || !Object.hasOwn(labels, result.state)) throw Error("服务状态不完整，请重新读取。");
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
  // Preserve the connection card's original feedback; maintenance controls live below.
  const installationFailed = !detection.job?.running && !detection.uncertain && (detection.job?.task?.status === "failed" || !detection.job?.task && detection.job?.phase === "error");
  useEffect(() => { if (installing || detection.attention || detection.feedback || installationFailed) setPreparation(true); }, [installing, detection.attention, detection.feedback, installationFailed]);
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
  const selection = useRef(device);
  const navigation = useRef<Promise<void> | null>(Promise.resolve());
  const selectionEpoch = useRef(0);
  const setup = useRef<SetupControls>(null), connector = useRef<ConnectionControls>(null);
  const updates = useRef<DesktopUpdateControls>(null);
  const openButton = useRef<HTMLButtonElement>(null), connectionCard = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [errorPending, setErrorPending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const pending = useRef<Promise<void> | null>(null);
  const requested = useRef(false);
  const manualError = useRef(false);

  async function act(action: Action, quiet = false) {
    if (quiet ? pending.current || requested.current : requested.current) return;
    if (!quiet) { requested.current = true; manualError.current = false; setBusy(action); setError(""); setErrorPending(false); }
    // Status polling has a bounded IPC deadline. Reserve the user action while
    // waiting so a poll cannot discard a confirmed start/stop/open request.
    if (pending.current) await pending.current;
    const observed = revision.current;
    const request = (async () => {
      try {
        const result = await invoke(action);
        setService(result); setServiceUncertain(false);
        if (observed === revision.current && result.desktopView) setView(result.desktopView);
        if (observed === revision.current && (!quiet || !manualError.current)) setError("");
      }
      catch (err) {
        setServiceUncertain(true);
        if (observed === revision.current && (!quiet || !manualError.current)) { manualError.current = action !== "status" && !isDesktopResponsePending(err); setErrorPending(action === "status" || isDesktopResponsePending(err)); setError(err instanceof Error ? err.message : String(err)); }
      }
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
      return true;
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); return false; }
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
  useEffect(() => {
    if (view === "control") (connectionCard.current?.querySelector<HTMLButtonElement>(".startup-connect-button:not(:disabled)") ?? openButton.current)?.focus({ preventScroll: true });
  }, [view]);
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
  const serviceKnown = !!service && !serviceUncertain;
  const running = serviceKnown && service?.state === "running";
  const localConnecting = mode === "local" && remoteBusy;
  const blocked = !!busy || updating || installing || localConnecting;
  const starting = serviceKnown && service?.state === "starting";
  const missing = serviceKnown && service?.state === "missing";
  const serviceState = serviceUncertain ? "unknown" : service?.state || "checking";
  const serviceLabel = updating ? "更新中" : busy === "start" ? "启动中" : busy === "stop" ? "关闭中" : serviceState === "unknown" ? "待核实" : serviceState === "checking" ? "检查中" : ({ running: "运行中", stopped: "已停止", starting: "启动中", stopping: "退出中", missing: "未安装", unmanaged: "端口占用" } as const)[serviceState];
  const detectionUnknown = detection.checking || detection.failed || !detection.environment;
  const customPort = connectionPort !== "4317";
  // Connecting an already healthy endpoint is navigation, not another maintenance write.
  const connectOnly = customPort;
  const primaryBlocked = !!busy && busy !== "status" || localConnecting || !connectOnly && (updating || installing);
  const primaryBusy = !!busy && busy !== "status" || remoteBusy || !connectOnly && (installing || updating || starting || missing && detection.checking);
  const readyToInstall = !detectionUnknown && detection.environment!.nodeReady && detection.environment!.writable;
  const needsRecovery = missing && !customPort && detection.attention && !detection.uncertain && !detection.job?.running;
  function showRecovery() { setPreparation(true); requestAnimationFrame(() => document.getElementById("setup-recovery")?.focus()); }
  const primaryLabel = connectOnly ? remoteBusy ? "连接中…" : "连接工作台" : installing ? detection.uncertain ? "正在核实安装结果…" : "正在安装…" : updating ? "正在更新…" : busy === "start" || starting ? "正在启动…" : busy === "stop" || serviceKnown && service?.state === "stopping" ? "正在关闭…" : remoteBusy ? "连接中…" : customPort ? "连接工作台" : !serviceKnown ? "校验状态" : missing ? service.artifact?.download.state === "verified" ? "安装" : "下载和安装" : running ? "关闭" : "启动";
  function primaryAction() {
    if (primaryBlocked) return;
    if (customPort) connector.current?.connect();
    else if (serviceUncertain || !service) void act("status");
    else if (missing) { setPreparation(true); setup.current?.installService(); }
    else if (service.state === "stopped") void act("start");
    else if (running) setConfirm(true);
  }
  function invalidateNavigation() {
    const epoch = selectionEpoch.current;
    const next = desktopInvoke<void>("axiom_controls"); navigation.current = next;
    void next.catch(cause => {
      if (selectionEpoch.current !== epoch || navigation.current !== next) return;
      navigation.current = null; // A retry must establish a fresh native barrier, not reuse a rejected one.
      setErrorPending(true); setError(cause instanceof Error ? cause.message : String(cause));
    });
    return next;
  }
  async function beforeConnect() {
    const epoch = selectionEpoch.current;
    await (navigation.current ?? invalidateNavigation());
    if (epoch !== selectionEpoch.current) throw Error("所选设备已变化，请连接当前设备。");
  }
  function selectDevice(value: string) {
    if (value === selection.current) return;
    selection.current = value; ++selectionEpoch.current; ++revision.current;
    setDevice(value); setRemoteBusy(false); setError("");
    remember("axiom.connection.mode", value === "local" ? "local" : "remote");
    // controls() advances the native revision before returning to the control view.
    // Wait for this barrier before allowing another target to open.
    void invalidateNavigation();
  }
  const updateNotice = useBackendUpdateNotification({ active: view === "workbench", connection, target: `${device}:${connectionPort}:${remoteUrl}`,
    canUpdate: mode === "local" && !customPort && !blocked && !serviceUncertain && service?.state === "running",
    onError: setError, onUpdate: async (version, runningVersion) => {
      if (mode !== "local" || customPort) throw Error("请在后台所在设备更新，未提交本机安装。");
      if (await showControls()) await updates.current?.checkAndUpdate(version, runningVersion);
    } });
  const connectionLabel = connection === "connected" ? "后台服务已连接" : connection === "disconnected" ? "后台服务已断开" : "后台服务确认中";
  const notifications: SystemNotice[] = updateNotice ? [updateNotice] : [];
  const installJob = detection.job;
  const transfer = installJob?.task?.transfer;
  const installProgress = installJob?.running ? installJob.progress ?? (transfer && { name: "服务安装包", downloaded: transfer.received, total: transfer.total, speed: transfer.bytesPerSecond || 0, startedAt: installJob.task?.startedAt || installJob.task?.createdAt || transfer.updatedAt, updatedAt: transfer.updatedAt, lastByteAt: transfer.updatedAt }) : null;
  return (
    <>
    <nav className="desktop-workbench-bar" aria-label="桌面导航" hidden={view !== "workbench"}>
      <div className="desktop-workbench-left">
        <SystemNotifications items={notifications} leading={{ id: "connection", content: <span className="desktop-workbench-status" data-state={connection} role="status" aria-live="polite" aria-label={connectionLabel}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.52" d="M1.88 12.21q2.32.02 4.62-.36q1.21-3.49 2.99-6.73q2.26 7.09 5.12 13.96q1.44-3.57 2.8-7.17q2.22.15 4.44.31" /></svg>
          <span>{connectionLabel}</span>
        </span> }} />
      </div>
      {error && error !== DESKTOP_RESPONSE_TIMEOUT_MESSAGE && <span role="alert" className="desktop-workbench-error" title={error}>{error}</span>}
      <div className="desktop-workbench-actions">
      <ThemeToggle />
      <button onClick={() => void showControls()} disabled={returning} aria-label={showDot ? "服务与更新，有待查看的变化" : "服务与更新"}>
        <Icon name="sliders-horizontal" />
        <span>服务与更新</span>{showDot && <i className="desktop-update-dot" aria-hidden="true" />}
      </button>
      </div>
    </nav>
    <main className="connect-page connect-refined" hidden={view === "workbench"}>
      <header className="connect-header"><span className="connect-brand"><BrandMark size={31} /><span>AXIOM<span className="startup-brand-version">2</span></span></span><span className="connect-header-actions"><span className="connect-local">你的私有工作台</span><ThemeToggle /></span></header>
      <div className="startup-title"><h1 className="startup-brand-title process-status-text is-active"><span>就绪之后，</span><span>专注创造。</span></h1><p>连接设备，管理本机服务与组件。</p></div>
      <section className="startup-panel" aria-label="连接与准备">
        <div ref={connectionCard} className="startup-device">
          <RemoteConnect controls={connector} local={mode === "local"} target={device === "manual" || device === "local" ? "" : device} disabled={localConnecting} beforeConnect={beforeConnect} onBusy={setRemoteBusy} onPortChange={setConnectionPort} primaryAction={mode === "local" ? <div className="connection-primary-area">
            <button ref={openButton} type="button" onClick={primaryAction} className={`connect-primary connection-primary-button${running ? " is-service-stop" : ""}`} hidden={connectOnly} disabled={primaryBlocked || !customPort && serviceKnown && (starting || service?.state === "stopping" || service?.state === "unmanaged")}><Icon name={primaryBusy ? "loader-circle" : missing && !customPort ? "download" : "power"} className={primaryBusy ? "startup-spin" : ""} /><span>{primaryLabel}</span></button>
            <div className="connection-primary-meta"><div className="connection-service-overview"><div className="connection-service-heading"><strong>本机后台服务</strong><span className="connection-status-tag" data-state={installing || updating ? "starting" : serviceState}>{installing ? "安装中" : serviceLabel}</span></div><span role="status">{customPort ? "连接此端口上已有的服务" : installing ? detection.foreground ? "安装在可见终端执行，可以切换设备" : "安装在后台继续，可以切换设备" : !serviceKnown ? "正在确认服务状态" : needsRecovery ? "自动处理上次未完成的安装" : missing ? service?.artifact?.download.state === "verified" ? "安装包已校验，可直接安装" : readyToInstall ? "下载并安装服务" : "自动准备环境并安装服务" : service?.state === "unmanaged" ? service.message || serviceLabel : running ? "服务已启动，可以连接工作台" : "启动后即可连接工作台"}</span></div>{starting && !customPort && <button type="button" className="connection-text-button connection-stop" aria-label="关闭后台服务" disabled={blocked || serviceUncertain} onClick={() => setConfirm(true)}><Icon name="power" />{starting ? "取消启动" : "关闭服务"}</button>}</div>
            {detection.feedback && <p className={detection.feedback.neutral ? "connect-message" : "connect-error"} role={detection.feedback.neutral ? "status" : "alert"}>{detection.feedback.message}</p>}
            {(installing || detection.uncertain || installationFailed) && <div className={installationFailed ? "connect-error" : "connect-message"} role={installationFailed ? "alert" : "status"}>{detection.uncertain ? "安装请求正在核实，可能仍在执行，请勿重复安装。" : installationFailed ? installJob?.task?.error?.message || installJob?.message : installJob?.message}<InstallProgress value={installProgress} running={!!installJob?.running} phase={installJob?.task?.phase ?? installJob?.phase} /></div>}
          </div> : undefined} onOpen={url => { if (selection.current !== device) return; setRemoteUrl(mode === "remote" ? url : ""); revision.current++; setView("workbench"); setConnection("checking"); lastConnection.current = "checking"; }}><DeviceSelect value={device} disabled={false} onChange={selectDevice} /></RemoteConnect>
          {mode === "remote" && installing && <p className="connect-message" role="status">{detection.foreground ? "本机安装在可见终端继续，切换设备不会中断。" : "本机安装仍在后台进行，切换设备不会中断。"}</p>}
        </div>
        <section className="startup-maintenance startup-update-section" hidden={mode !== "local"}>
          <DesktopUpdates controls={updates} service={serviceKnown ? service : null} serviceBusy={!!busy || installing || localConnecting || !serviceKnown} onBusyChange={setUpdating} onAvailableChange={setUpdateAvailable} onServiceChange={() => void act("status")} onInstallService={primaryAction} onMaintainService={(version, requireLatest) => { setPreparation(true); setup.current?.maintainService(version, requireLatest); }} />
        </section>
        <aside className="startup-tools" aria-label="本机维护">
        <div className="startup-tools-heading"><h2>维护工具</h2><p>环境准备与组件管理</p></div>
        <details className="startup-maintenance" hidden={mode !== "local"}><summary><Icon name="package" /><span className="startup-tool-copy">组件管理<small>查看安装位置与清理选项</small></span><Icon name="chevron-down" /></summary><DesktopEnvironment environment={detection.environment} serviceState={serviceKnown ? service?.state : undefined} /></details>
        {detection.attention && <div className="maintenance-warning startup-recovery-notice" role="status"><Icon name="circle-help" /><span>上次安装需要核实。</span><button className="maintenance-text-button" onClick={showRecovery}>核实并恢复<Icon name="chevron-right" /></button></div>}
        <details className="startup-preparation" open={preparation} onToggle={event => setPreparation(event.currentTarget.open)}><summary><ConnectionIcon name="package" /><span className="startup-tool-copy">环境与安装<small>{detection.checking ? "检查中" : detectionUnknown ? "待检查" : readyToInstall ? "环境已就绪" : "需要准备"}</small></span><Icon name="chevron-down" /></summary>
          <SetupWizard controls={setup} remote={mode === "remote"} service={serviceKnown ? service : null} blocked={!!busy || updating || localConnecting || !serviceKnown} onBusy={setInstalling} onComplete={() => void act("status")} onDetection={setDetection} />
        </details>
        </aside>
        {error && <p className={errorPending ? "connect-message startup-global-error" : "connect-error startup-global-error"} role={errorPending ? "status" : "alert"}>{error}<IconButton label="重新读取服务状态" icon="refresh-cw" disabled={!!busy} onClick={() => void act("status")} /></p>}
      </section>
      <footer className="connect-footer"><span><ConnectionIcon name="privacy" />文件和任务留在你的电脑上</span><span>{service?.background === false ? "服务终端需保持打开，关闭终端会停止服务" : "关闭客户端不会停止服务"}</span></footer>
      {confirm && <ConfirmDialog title="关闭后台服务？" danger cancelLabel="继续运行" confirmLabel="确认关闭服务"
        description={<>{service?.active.length ? `当前有 ${service.active.length}${service.active.length >= 20 ? "+" : ""} 个会话正在执行任务，关闭服务会中断这些任务。` : "关闭后将返回服务控制页，尚未结束的任务将被停止。"}项目和会话记录会保留。</>}
        confirmDisabled={blocked || serviceUncertain} onClose={() => setConfirm(false)}
        onConfirm={() => { setConfirm(false); void act("stop"); }}>
        {!!service?.active.length && <ul>{service.active.map((title, index) => <li key={index}>{title || "未命名会话"}</li>)}</ul>}
      </ConfirmDialog>}
    </main>
    </>
  );
}
