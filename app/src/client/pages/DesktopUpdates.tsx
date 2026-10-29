import { DesktopTaskCenter } from "../maintenance/DesktopTaskCenter.js";
import { Icon } from "../Icon.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import { BudgetEditor, MaintenanceTaskView } from "../maintenance/MaintenanceView.js";
import { defaultMaintenanceBudgets, type MaintenanceTask, type MaintenanceBudgets } from "../../shared/maintenance.js";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { LocalPath } from "../LocalPath.js";
import { desktopInvoke, DesktopResponsePendingError, isDesktopResponsePending } from "./desktop-bridge.js";
import { isSubmissionRefused, observesSubmission, validOperationJob } from "./desktop-operation.js";
import InstallProgress from "./InstallProgress.js";

type UpdateAction = "status" | "check" | "pi-check" | "pi-refresh" | "pi" | "service" | "client" | "recover" | "installer" | "cancel" | "extend" | "defaults" | "reconcile";
type Update = {
  pi?: {
    /** Dependency version in the registered backend installation, not a live runtime probe. */
    runtimeVersion: string | null;
    cli: { version?: string | null; packageRoot?: string; error?: string; legacy?: boolean; repairRequired?: boolean; repairReason?: string } | null;
    release: { version: string; checkedAt: number; token: string | null } | null;
  };
  clientInstaller?: { version: string; readyAt: number } | null;
  clientVersion: string; serviceVersion: string | null; managed: boolean; clientSupported: boolean;
  clientPlatform?: string; clientAsset?: string | null; clientCheckedAt?: number | null; clientReleaseError?: string | null;
  clientRelease?: { version: string; checkedAt: number; assets: Record<string, { url: string }> } | null;
  releaseError?: string | null;
  foregroundSupported?: boolean; serviceInstallation?: "foreground" | "registered" | "absent" | "unknown"; serviceError?: string | null;
  release: { version: string; checkedAt: number; assets: Record<string, { url: string }> } | null;
  budgets?: MaintenanceBudgets;
  job: { task?: MaintenanceTask; kind: string; version?: string; running: boolean; phase: string; message: string; download?: unknown; updatedAt?: number; reconciled?: boolean; servicePending?: boolean } | null;
  execution?: { lines: string[]; updatedAt: number | null } | null;
  recovery: boolean; log: string;
};
function newer(a: string | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
async function invoke(action: UpdateAction, version?: string): Promise<Update> {
  const result = await desktopInvoke<Update>("axiom_update", { action, version: version || null }, action === "pi-check" ? 75_000 : 55_000);
  if (action !== "installer" && (!result || typeof result.clientVersion !== "string")) throw new DesktopResponsePendingError("更新状态不完整，结果尚未确认，请重新读取。");
  return result;
}
export type DesktopUpdateControls = { checkAndUpdate: (version: string, runningVersion: string | null) => Promise<void> };
export default function DesktopUpdates({ controls, service, serviceBusy, onBusyChange, onAvailableChange, onServiceChange, onInstallService, onMaintainService }: {
  controls?: Ref<DesktopUpdateControls>;
  service: { state: string; active: string[] } | null; serviceBusy: boolean; onInstallService?: () => void; onMaintainService?: (version: string, requireLatest: boolean) => void;
  onBusyChange: (busy: boolean) => void; onAvailableChange: (available: boolean) => void; onServiceChange: () => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const section = useRef<HTMLElement>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [busy, setBusy] = useState<UpdateAction | null>(null);
  const [error, setError] = useState<{ action: UpdateAction; message: string; neutral?: boolean } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const unconfirmed = useRef<{ action: UpdateAction; previousId?: string; sentAt: number } | null>(null);
  const [confirm, setConfirm] = useState<"service" | "service-reinstall" | "recover" | "installer" | "pi" | null>(null);
  const confirmedPi = useRef<{ token: string; version: string; installed: boolean; packageRoot?: string } | null>(null);
  const confirmedService = useRef<string | null>(null);
  const confirmedInstalledService = useRef<string | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const requested = useRef(false);
  const previousRunning = useRef(false);
  const manualError = useRef(false);
  const latest = update?.release?.version;
  // Older desktop helpers only describe Windows MSI assets. Never infer a Mac
  // update (or a current-version claim) from the backend release number.
  const clientRelease = update && Object.hasOwn(update, "clientRelease") ? update.clientRelease : (update?.clientSupported && update?.release?.assets?.["Axiom2.msi"] ? update.release : null);
  const clientLatest = clientRelease?.version;
  const clientName = update?.clientPlatform === "darwin" ? "macOS 客户端" : update?.clientPlatform === "win32" ? "Windows 客户端" : update?.clientPlatform === "linux" ? "Linux 客户端" : "桌面客户端";
  const clientAsset = update?.clientAsset ?? (update?.clientSupported ? "Axiom2.msi" : null);
  const clientDownload = clientAsset ? clientRelease?.assets?.[clientAsset]?.url : undefined;
  const trustedClientDownload = clientDownload && clientLatest && clientDownload === `https://github.com/cosyeezz/axiom2/releases/download/v${clientLatest}/${clientAsset}` ? clientDownload : undefined;
  const serviceVersion = update?.serviceVersion;
  const serviceMissing = update?.serviceInstallation === "absent" && !serviceVersion;
  const foregroundMaintenance = !!update?.foregroundSupported && !!onMaintainService;
  const serviceVersionLabel = serviceVersion ? `v${serviceVersion}` : serviceMissing ? "未安装" : !update && !error ? "正在读取…" : "版本未能读取";
  const installerVersion = update?.clientInstaller?.version ?? (update?.job?.kind === "client" && update.job.phase === "ready" ? update.job.version : undefined);
  const installerReady = newer(installerVersion, update?.clientVersion);
  const running = !!update?.job?.running;
  const needsReconciliation = !update?.job?.reconciled && (update?.job?.task?.status === "unknown" || update?.job?.task?.status === "interrupted" || update?.job?.phase === "interrupted");
  const backendBusy = uncertain || (running && update?.job?.kind !== "client") || busy === "service" || busy === "recover" || busy === "pi";
  const disabled = !!busy || running || serviceBusy || uncertain || needsReconciliation;
  const ordinaryDisabled = disabled || !!update?.job?.servicePending;
  const pi = update?.pi;
  const installedPiVersionLabel = pi?.runtimeVersion ? `v${pi.runtimeVersion}` : serviceMissing ? "后台未安装" : !update && !error ? "正在读取…" : "版本未能读取";
  const piNewer = newer(pi?.release?.version, pi?.cli?.version);
  const piReady = !!pi?.cli && !pi.cli.error && !pi.cli.legacy;
  const piRetry = !!pi?.cli?.repairRequired || update?.job?.kind === "pi" && ["error", "interrupted"].includes(update.job.phase) && pi?.cli?.version === pi?.release?.version;
  const piError = error?.action.startsWith("pi");
  const actionDisabled = {
    service: ordinaryDisabled || !!update?.recovery || !foregroundMaintenance && (!update?.managed || !["running", "stopped"].includes(service?.state || "")),
    recover: disabled || !update?.recovery,
    installer: ordinaryDisabled || !installerReady,
    pi: ordinaryDisabled || !pi?.release?.token || !piReady || (!!pi.cli?.version && !piNewer && !piRetry),
  };
  const serviceBlockedReason = !update ? "正在读取更新能力。" : uncertain ? "上次请求结果尚未确认，请先核实。" : needsReconciliation || update.job?.servicePending ? "上次维护尚未核实，请先核实并恢复。" : running || busy || serviceBusy ? "已有维护操作正在进行，请等待完成。" : update.recovery ? "请先恢复之前的服务版本。" : !foregroundMaintenance && !update.managed ? "此后台不是桌面客户端管理的安装，请使用原安装方式更新。" : !foregroundMaintenance && service?.state === "unmanaged" ? "端口被非托管后台占用。请先在原启动位置退出该后台，再启动桌面管理的服务后更新；不会自动停止或覆盖当前后台。" : !foregroundMaintenance && !["running", "stopped"].includes(service?.state || "") ? "尚未确认后台运行状态，请先重新读取服务状态。" : undefined;
  // A poll can invalidate an open confirmation. Keep Pi\'s explicit version/token snapshot,
  // while applying the same current safety gates as the entry button.
  const confirmationDisabled = (action: "service" | "service-reinstall" | "recover" | "installer" | "pi") => action === "pi"
    ? ordinaryDisabled || !confirmedPi.current?.token || !pi?.release?.token || !piReady || (!!pi.cli?.version && !newer(confirmedPi.current.version, pi.cli.version) && !piRetry)
    : action === "service-reinstall" ? ordinaryDisabled || !!update?.recovery || !foregroundMaintenance || !confirmedService.current || confirmedInstalledService.current !== (serviceVersion ?? null)
    : action === "service" ? actionDisabled.service || !confirmedService.current || confirmedService.current !== latest || confirmedInstalledService.current !== (serviceVersion ?? null) : actionDisabled[action];
  const completed = !running && (update?.job?.task ? update.job.task.status === "succeeded" : update?.job?.phase === "done");
  const progress = completed ? null : <>{update?.job?.task ? <MaintenanceTaskView compact task={update.job.task} onReconcile={() => control("reconcile", { id: update.job!.task!.id })} showError={!historyOpen} connected onCancel={() => control("cancel", { id: update.job!.task!.id })} onExtend={budgets => control("extend", { id: update.job!.task!.id, budgets })} /> : update?.job && <><p className={`connect-update-progress ${update.job.phase === "error" && !running ? "has-error" : ""}`} role="status" aria-live="polite">{running && <span className="connect-update-pulse" aria-hidden="true" />}{update.job.message}</p><InstallProgress value={update.job.download} running={running}  /></>}{update?.job?.kind === "pi" && <>{running && <p className="connect-footnote">{update.execution?.updatedAt ? `最近日志输出于 ${Math.max(0, Math.floor((Date.now() - update.execution.updatedAt) / 1000))} 秒前；无新输出不代表下载已停止。` : "等待 npm 输出；安装期间无法计算整体百分比。"}</p>}{!!update.execution?.lines.length && <details><summary>执行详情</summary><pre className="connect-update-log">{update.execution.lines.join("\n")}</pre></details>}</>}</>;
  async function control(action: UpdateAction, payload: Record<string, unknown>) {
    await invoke(action, JSON.stringify(payload));
    // A control acknowledgement can contain an older job snapshot. Re-read instead.
    await act("status", true);
  }
  async function act(action: UpdateAction, quiet = false) {
    if (quiet ? pending.current || requested.current : requested.current || uncertain) return;
    if ((action === "service" || action === "recover" || action === "installer" || action === "pi") && confirmationDisabled(action)) return;
    // Reserve manual actions while a status poll finishes, including confirmed installs.
    if (!quiet) { requested.current = true; setBusy(action); setError(null); manualError.current = false; }
    if (pending.current) await pending.current;
    if (action === "service" || action === "recover" || action === "pi") onBusyChange(true);
    const mutation = ["pi", "service", "client", "recover", "installer"].includes(action);
    let accepted: Update | undefined;
    const attempt = { action, previousId: update?.job?.task?.id, sentAt: Date.now() };
    const accept = (result: Update) => {
      if (action === "installer") { unconfirmed.current = null; setUncertain(false); return; }
      if (!result || typeof result.clientVersion !== "string" || !Object.hasOwn(result, "job") || result.job !== null && !validOperationJob(result.job) || mutation && result.job?.kind !== action) throw new DesktopResponsePendingError("更新响应不完整，结果尚未确认，正在核实原任务。");
      setUpdate(result); accepted = result;
      const waiting = unconfirmed.current;
      if (mutation || waiting && observesSubmission(waiting, result.job)) { unconfirmed.current = null; setUncertain(false); }
      if (previousRunning.current && !result.job?.running) onServiceChange();
      previousRunning.current = !!result.job?.running;
      if (!quiet || !manualError.current || result.job?.running) { manualError.current = false; setError(null); }
    };
    const request = (async () => {
      try { accept(await invoke(action, action === "pi" ? confirmedPi.current?.token : action === "service" ? confirmedService.current ?? undefined : action === "client" ? clientLatest : undefined)); }
      catch (cause) {
        const waiting = isDesktopResponsePending(cause), neutral = !mutation || waiting;
        if (!quiet) manualError.current = !neutral;
        if (!quiet || !manualError.current) setError({ action, message: cause instanceof Error ? cause.message : String(cause), neutral });
        if (mutation && waiting) {
          unconfirmed.current = attempt; setUncertain(true);
          if (cause instanceof DesktopResponsePendingError && cause.response) void cause.response.then(value => {
            if (unconfirmed.current !== attempt) return;
            try { accept(value as Update); } catch { setError({ action, message: "原更新响应不完整，结果尚未确认，正在核实。", neutral: true }); }
          }, failure => {
            if (unconfirmed.current !== attempt) return;
            const refused = isSubmissionRefused(failure);
            if (refused) { unconfirmed.current = null; setUncertain(false); }
            setError({ action, message: refused ? (failure instanceof Error ? failure.message : String(failure)) : "原更新请求结果尚未确认，正在核实，请勿重复提交。", neutral: !refused });
          });
        }
      }
    })();
    pending.current = request;
    try { await request; }
    finally { if (pending.current === request) pending.current = null; if (!quiet) { requested.current = false; setBusy(null); } }
    return accepted;
  }
  useEffect(() => {
    void act("pi-refresh");
    const timer = window.setInterval(() => { void act("status", true); }, 2000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { onBusyChange(backendBusy); }, [backendBusy, onBusyChange]);
  const available = newer(latest, serviceVersion) || newer(clientLatest, update?.clientVersion) || (piReady && (piNewer || piRetry));
  useEffect(() => { onAvailableChange(available); }, [available, onAvailableChange]);
  useImperativeHandle(controls, () => ({ checkAndUpdate: (version, runningVersion) => ask("service", { version, runningVersion }) }));
  const ask = async (action: "service" | "service-reinstall" | "recover" | "installer" | "pi", expected?: { version: string; runningVersion: string | null }) => {
    if (ordinaryDisabled) return;
    if (action === "pi") {
      const current = pi?.release?.token && piReady ? update : await act("pi-check");
      const next = current?.pi;
      if (!next?.release?.token || !next.cli || next.cli.error || next.cli.legacy) {
        if (current) setError({ action: "pi-check", message: next?.cli?.error || (next?.cli?.legacy ? "请先通过原安装方式迁移旧版 Pi。" : "尚未取得可安装的 Pi 版本，请重试。"), neutral: false });
        return;
      }
      const retry = next.cli.repairRequired || current?.job?.kind === "pi" && ["error", "interrupted"].includes(current.job.phase) && next.cli.version === next.release.version;
      if (next.cli.version && !newer(next.release.version, next.cli.version) && !retry) { setError({ action: "pi-check", message: "终端 Pi 已是最新版本。", neutral: true }); return; }
      confirmedPi.current = { token: next.release.token, version: next.release.version, installed: !!next.cli.version, packageRoot: next.cli.packageRoot };
    } else if (action === "service" || action === "service-reinstall") {
      const current = action === "service-reinstall" && (update?.serviceVersion || update?.release) ? update : await act("check");
      if (!current) return;
      if (expected?.runningVersion && current.serviceVersion !== expected.runningVersion) { setError({ action: "check", message: "当前连接后台与登记安装版本不一致，请确认运行入口后使用原安装方式更新。", neutral: false }); return; }
      if (expected && current.release && newer(expected.version, current.release.version)) { setError({ action: "check", message: "检查结果仍旧于通知版本，请稍后重新检查；未提交更新。", neutral: false }); return; }
      if (!(current.foregroundSupported && onMaintainService) && !current.managed) { setError({ action: "check", message: "请使用此服务原来的安装方式更新。", neutral: false }); return; }
      const target = action === "service-reinstall" ? current.serviceVersion || current.release?.version : current.release?.version;
      if (!target || action === "service" && !current.serviceVersion) { setError({ action: "check", message: "未读取到安装版本，请重新检查。", neutral: true }); return; }
      if (action === "service" && !newer(target, current.serviceVersion)) { setError({ action: "check", message: "后台服务已是最新版本。", neutral: true }); return; }
      confirmedService.current = target;
      confirmedInstalledService.current = current.serviceVersion;
    } else if (actionDisabled[action]) return;
    setConfirm(action);
  };
  return (
    <section ref={section} tabIndex={-1} className="connect-updates updates-simple" aria-label="版本与更新">
      <div className="updates-section-heading"><div><h2>版本与更新</h2><p>管理本机后台、应用内引擎、终端 Pi 与客户端</p></div><Icon name="refresh-cw" aria-hidden="true" /></div>
      <section className="update-component" aria-label="后台服务更新">
        <div className="update-component-row">
          <div className="update-component-identity"><span className="update-component-icon"><Icon name="server" /></span><div className="update-component-copy"><h3>后台服务</h3><p>{serviceVersionLabel}{latest && serviceVersion && <span>{newer(latest, serviceVersion) ? `可更新至 v${latest}` : "已是最新版本"}</span>}</p></div></div>
          <div className="connect-actions">
            <button className="connect-secondary" aria-label="检查更新" disabled={ordinaryDisabled} onClick={() => void act("check")}>{busy === "check" ? "正在检查…" : "检查更新"}</button>
            {serviceMissing ? <button className="connect-secondary" disabled={ordinaryDisabled || !onInstallService} onClick={onInstallService}>安装</button> : <button className="connect-secondary" aria-label="更新后台服务" title={serviceBlockedReason} disabled={actionDisabled.service} onClick={() => void ask("service")}>检查并更新</button>}
            <button className="connect-secondary" disabled={ordinaryDisabled || !!update?.recovery || !foregroundMaintenance} onClick={() => void ask("service-reinstall")}>重新安装</button>
            {update?.recovery && <button className="connect-secondary" disabled={actionDisabled.recover} onClick={() => ask("recover")}>恢复旧版本</button>}
          </div>
        </div>
        <p className="connect-update-detail update-runtime-version">应用内 Pi 引擎（后台安装版本）：<strong>{installedPiVersionLabel}</strong>。随后台服务更新，用于应用内会话与工具执行。</p>
        {update?.releaseError && <p className="connect-update-detail" role="status">后台版本检查失败：{update.releaseError}</p>}
        {update?.serviceError && <p className="connect-message">{update.serviceError}</p>}
        {actionDisabled.service && serviceBlockedReason && <p className="connect-update-detail" role="status">{serviceBlockedReason}</p>}
        {update && !foregroundMaintenance && (!update.managed || service?.state === "unmanaged") && <a className="connect-update-detail" href="https://github.com/cosyeezz/axiom2#一行安装与客户端下载" target="_blank" rel="noreferrer">查看安装与更新方式</a>}
        {update?.job && !["pi", "client"].includes(update.job.kind) && progress}
        {error && !historyOpen && !piError && error.message !== update?.job?.message && <p className={error.neutral || running ? "connect-message" : "connect-error"} role={error.neutral || running ? "status" : "alert"}>{error.message}</p>}
      </section>
      <section className="update-component" aria-labelledby="pi-heading" aria-busy={busy?.startsWith("pi") || (running && update?.job?.kind === "pi")}>
        <div className="update-component-row">
          <div className="update-component-identity"><span className="update-component-icon"><Icon name="square-terminal" /></span><div className="update-component-copy"><h3 id="pi-heading">终端 Pi</h3><p>{pi?.cli?.error ? "状态读取失败" : pi?.cli?.legacy ? "需要迁移" : pi?.cli?.version ? `v${pi.cli.version}` : pi?.cli ? "未安装" : "正在读取…"}{piReady && pi?.release && <span>{!pi.cli?.version || piNewer ? `可安装 v${pi.release.version}` : piRetry ? "需要重新安装" : "终端已是最新版本"}</span>}</p></div></div>
          <div className="connect-actions">
            <button className="connect-secondary" aria-label="检查终端 Pi 更新" disabled={ordinaryDisabled} onClick={() => void act("pi-check")}>{busy === "pi-check" ? "正在检查…" : "检查更新"}</button>
            <button className="connect-secondary" aria-label={piRetry ? "重新安装终端 Pi" : pi?.cli?.version ? "更新终端 Pi" : "安装终端 Pi"} disabled={ordinaryDisabled} onClick={() => void ask("pi")}>{busy === "pi" || (running && update?.job?.kind === "pi") ? "正在安装…" : piRetry ? "重新安装" : pi?.cli?.version ? "更新" : "安装"}</button>
          </div>
        </div>
        <p className="connect-update-detail">独立的终端程序；此处仅管理终端 Pi。应用内 Pi 引擎请通过后台服务更新。</p>
        {pi?.cli?.error && !historyOpen && <p className="connect-error" role="alert">{pi.cli.error}<button className="maintenance-text-button" disabled={ordinaryDisabled} onClick={() => void act("pi-refresh")}>重试</button></p>}
        {pi?.cli?.repairRequired && <p className="connect-message">{pi.cli.repairReason || "请检查更新后重新安装。"}</p>}
        {pi?.cli?.legacy && <p className="connect-message">请先通过原安装方式迁移旧版 Pi。</p>}
        {piReady && pi?.release && !pi.release.token && (!pi.cli?.version || piNewer || piRetry) && <p className="connect-update-detail">安装状态已变化，请重新检查更新。</p>}
        {update?.job?.kind === "pi" && progress}
        {error && !historyOpen && piError && error.message !== update?.job?.message && <p className={error.neutral || running ? "connect-message" : "connect-error"} role={error.neutral || running ? "status" : "alert"}>{error.message}</p>}
      </section>
      <section className="update-component" aria-label="客户端更新">
        <div className="update-component-row">
          <div className="update-component-identity"><span className="update-component-icon"><Icon name="monitor" /></span><div className="update-component-copy"><h3>{clientName}</h3><p>{update?.clientVersion ? `v${update.clientVersion}` : "正在读取…"}{clientLatest && <span>{newer(clientLatest, update?.clientVersion) ? `可更新至 v${clientLatest}` : "本平台已是最新版本"}</span>}{!clientLatest && update?.clientCheckedAt && <span>本平台暂无可用安装包</span>}</p></div></div>
          <div className="connect-actions">
            {update?.clientSupported && clientRelease?.assets?.["Axiom2.msi"] && <button className="connect-secondary" aria-label="下载客户端更新" disabled={ordinaryDisabled || !newer(clientLatest, update.clientVersion)} onClick={() => void act("client")}>下载更新</button>}
            {!update?.clientSupported && trustedClientDownload && newer(clientLatest, update?.clientVersion) && <a className="connect-secondary" href={trustedClientDownload} target="_blank" rel="noreferrer">下载本平台更新</a>}
            {installerReady && <button className="connect-secondary" disabled={actionDisabled.installer} onClick={() => ask("installer")}>安装更新</button>}
          </div>
        </div>
        {update?.clientReleaseError && <p className="connect-update-detail" role="status">{update.clientReleaseError} 请重新检查更新；未将后台版本作为客户端版本。</p>}
        {update && !clientLatest && !update.clientCheckedAt && !update.clientReleaseError && <p className="connect-update-detail">尚未检查本平台客户端版本，请点击“检查更新”。</p>}
        {update?.job?.kind === "client" && progress}
      </section>
      {(needsReconciliation || update?.job?.servicePending) && <div className="update-recovery" role="status"><p>上次更新尚未完成核实，不会重复安装。</p>{needsReconciliation && update?.job?.task && <button className="connect-secondary" disabled={!!busy || running || serviceBusy || uncertain} onClick={() => void control("reconcile", { id: update.job!.task!.id }).catch(cause => setError({ action: "reconcile", message: String(cause), neutral: true }))}>核实并恢复</button>}</div>}
      <details className="maintenance-details update-details"><summary><Icon name="history" /><span>更新详情与记录</span><Icon name="chevron-down" /></summary>
        <button className="maintenance-text-button" onClick={() => setHistoryOpen(true)}><Icon name="history" />更新任务记录</button>
        <p className="connect-update-detail">应用内 Pi 版本来自本机登记后台的安装依赖，并非运行中进程的版本查询；终端 Pi 版本来自所选 npm 全局安装。</p>
        {pi?.cli?.packageRoot && <p className="connect-log">终端 Pi 安装位置：<LocalPath path={pi.cli.packageRoot} onOpen={() => desktopInvoke("axiom_reveal_path", { path: pi.cli!.packageRoot })} /></p>}
        <details className="maintenance-details"><summary>下载与安装设置</summary><BudgetEditor value={update?.budgets ?? defaultMaintenanceBudgets} onSave={budgets => control("defaults", { budgets })} /></details>
        {update?.log && <p className="connect-log">更新日志：<LocalPath path={update.log} onOpen={() => desktopInvoke("axiom_reveal_path", { path: update.log })} /></p>}
      </details>
      {historyOpen && <DesktopTaskCenter kind="update" current={update?.job?.task} onClose={() => setHistoryOpen(false)} onSource={() => { setHistoryOpen(false); window.requestAnimationFrame(() => section.current?.focus()); }} onChanged={() => void act("status", true)} />}
      {confirm && <ConfirmDialog
        title={confirm === "pi" ? `${confirmedPi.current?.installed ? "更新" : "安装"}终端 Pi ${confirmedPi.current?.version}？` : confirm === "installer" ? "打开客户端安装向导？" : confirm === "recover" ? "恢复之前的服务版本？" : confirm === "service-reinstall" ? `重新安装后台 v${confirmedService.current}？` : `更新后台至 ${confirmedService.current}？`}
        description={confirm === "pi" ? "仅管理独立终端程序，应用内 Pi 引擎随后台服务更新。保留个人设置。请先结束使用此安装的 Pi 终端会话，完成后重新打开。" : confirm === "installer" ? "安装包已经校验。将关闭本客户端并打开安装向导，后台服务继续运行。" : foregroundMaintenance && (confirm === "service" || confirm === "service-reinstall") ? "会正常关闭可管理的旧服务，并安装所选版本；项目、会话和设置保留。完成后点击启动。" : "将停止本机后台及其正在执行的任务，保留项目和会话。请先保存工作。"}
        warning={confirm !== "installer" && confirm !== "pi" && !foregroundMaintenance ? "此功能要求当前数据目录独占此安装；共用安装请使用原安装方式更新。" : undefined}
        danger={confirm === "service" || confirm === "service-reinstall" || confirm === "recover"} confirmDisabled={confirmationDisabled(confirm)}
        cancelLabel={confirm === "service" ? "暂不更新" : "取消"}
        confirmLabel={confirm === "pi" ? confirmedPi.current?.installed ? "确认更新终端 Pi" : "确认安装终端 Pi" : confirm === "installer" ? "打开安装向导" : confirm === "recover" ? "确认恢复" : confirm === "service-reinstall" ? "确认重新安装" : "确认更新服务"}
        onClose={() => setConfirm(null)} onConfirm={() => {
          if (confirmationDisabled(confirm)) return;
          setConfirm(null);
          if ((confirm === "service" || confirm === "service-reinstall") && foregroundMaintenance && confirmedService.current) onMaintainService?.(confirmedService.current, confirm === "service");
          else if (confirm !== "service-reinstall") void act(confirm);
        }}>
        {confirm === "pi" && confirmedPi.current?.packageRoot && <p className="confirm-location">安装位置：<LocalPath path={confirmedPi.current.packageRoot} onOpen={() => desktopInvoke("axiom_reveal_path", { path: confirmedPi.current!.packageRoot })} /></p>}
        {confirm !== "installer" && confirm !== "pi" && !!service?.active.length && <details><summary>受影响的会话 · {service.active.length}</summary><ul>{service.active.map((title, index) => <li key={index}>{title || "未命名会话"}</li>)}</ul></details>}
      </ConfirmDialog>}
    </section>
  );
}
