import { DesktopTaskCenter } from "../maintenance/DesktopTaskCenter.js";
import { Icon } from "../Icon.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import { BudgetEditor, MaintenanceTaskView } from "../maintenance/MaintenanceView.js";
import { defaultMaintenanceBudgets, type MaintenanceTask, type MaintenanceBudgets } from "../../shared/maintenance.js";
import { useEffect, useRef, useState } from "react";
import { LocalPath } from "../LocalPath.js";
import { desktopInvoke, DesktopResponsePendingError, isDesktopResponsePending } from "./desktop-bridge.js";
import { isSubmissionRefused, observesSubmission, validOperationJob } from "./desktop-operation.js";
import InstallProgress from "./InstallProgress.js";

type UpdateAction = "status" | "check" | "pi-check" | "pi-refresh" | "pi" | "service" | "client" | "recover" | "installer" | "cancel" | "extend" | "defaults" | "reconcile";
type Update = {
  pi?: { runtimeVersion: string | null; cli: { version?: string | null; packageRoot?: string; error?: string; legacy?: boolean; repairRequired?: boolean; repairReason?: string } | null; release: { version: string; checkedAt: number; token: string | null } | null };
  clientInstaller?: { version: string; readyAt: number } | null;
  clientVersion: string; serviceVersion: string | null; managed: boolean; clientSupported: boolean;
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
export default function DesktopUpdates({ service, serviceBusy, onBusyChange, onAvailableChange, onServiceChange, onInstallService }: {
  service: { state: string; active: string[] } | null; serviceBusy: boolean; onInstallService?: () => void;
  onBusyChange: (busy: boolean) => void; onAvailableChange: (available: boolean) => void; onServiceChange: () => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const section = useRef<HTMLElement>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [busy, setBusy] = useState<UpdateAction | null>(null);
  const [error, setError] = useState<{ action: UpdateAction; message: string; neutral?: boolean } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const unconfirmed = useRef<{ action: UpdateAction; previousId?: string; sentAt: number } | null>(null);
  const [confirm, setConfirm] = useState<"service" | "recover" | "installer" | "pi" | null>(null);
  const confirmedPi = useRef<{ token: string; version: string; installed: boolean; packageRoot?: string } | null>(null);
  const confirmedService = useRef<string | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const requested = useRef(false);
  const previousRunning = useRef(false);
  const manualError = useRef(false);
  const latest = update?.release?.version;
  const installerVersion = update?.clientInstaller?.version ?? (update?.job?.kind === "client" && update.job.phase === "ready" ? update.job.version : undefined);
  const installerReady = newer(installerVersion, update?.clientVersion);
  const running = !!update?.job?.running;
  const needsReconciliation = !update?.job?.reconciled && (update?.job?.task?.status === "unknown" || update?.job?.task?.status === "interrupted" || update?.job?.phase === "interrupted");
  const backendBusy = uncertain || (running && update?.job?.kind !== "client") || busy === "service" || busy === "recover" || busy === "pi";
  const disabled = !!busy || running || serviceBusy || uncertain || needsReconciliation;
  const ordinaryDisabled = disabled || !!update?.job?.servicePending;
  const pi = update?.pi;
  const piNewer = newer(pi?.release?.version, pi?.cli?.version);
  const piReady = !!pi?.cli && !pi.cli.error && !pi.cli.legacy;
  const piRetry = !!pi?.cli?.repairRequired || update?.job?.kind === "pi" && ["error", "interrupted"].includes(update.job.phase) && pi?.cli?.version === pi?.release?.version;
  const piError = error?.action.startsWith("pi");
  const actionDisabled = {
    service: ordinaryDisabled || !update?.managed || !!update.recovery || !newer(latest, update.serviceVersion) || !["running", "stopped"].includes(service?.state || ""),
    recover: disabled || !update?.recovery,
    installer: ordinaryDisabled || !installerReady,
    pi: ordinaryDisabled || !pi?.release?.token || !piReady || (!!pi.cli?.version && !piNewer && !piRetry),
  };
  // A poll can invalidate an open confirmation. Keep Pi\'s explicit version/token snapshot,
  // while applying the same current safety gates as the entry button.
  const confirmationDisabled = (action: "service" | "recover" | "installer" | "pi") => action === "pi"
    ? ordinaryDisabled || !confirmedPi.current?.token || !pi?.release?.token || !piReady || (!!pi.cli?.version && !newer(confirmedPi.current.version, pi.cli.version) && !piRetry)
    : action === "service" ? actionDisabled.service || !confirmedService.current || confirmedService.current !== latest : actionDisabled[action];
  const progress = <>{update?.job?.task ? <MaintenanceTaskView compact task={update.job.task} onReconcile={() => control("reconcile", { id: update.job!.task!.id })} showError={!historyOpen} connected onCancel={() => control("cancel", { id: update.job!.task!.id })} onExtend={budgets => control("extend", { id: update.job!.task!.id, budgets })} /> : update?.job && <><p className={`connect-update-progress ${update.job.phase === "error" && !running ? "has-error" : ""}`} role="status" aria-live="polite">{running && <span className="connect-update-pulse" aria-hidden="true" />}{update.job.message}</p><InstallProgress value={update.job.download} running={running}  /></>}{update?.job?.kind === "pi" && <>{running && <p className="connect-footnote">{update.execution?.updatedAt ? `最近日志输出于 ${Math.max(0, Math.floor((Date.now() - update.execution.updatedAt) / 1000))} 秒前；无新输出不代表下载已停止。` : "等待 npm 输出；安装期间无法计算整体百分比。"}</p>}{!!update.execution?.lines.length && <details><summary>执行详情</summary><pre className="connect-update-log">{update.execution.lines.join("\n")}</pre></details>}</>}</>;
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
      try { accept(await invoke(action, action === "pi" ? confirmedPi.current?.token : action === "service" ? confirmedService.current ?? undefined : action === "client" ? latest : undefined)); }
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
  const available = newer(latest, update?.serviceVersion) || newer(latest, update?.clientVersion) || (piReady && (piNewer || piRetry));
  useEffect(() => { onAvailableChange(available); }, [available, onAvailableChange]);
  const ask = async (action: "service" | "recover" | "installer" | "pi") => {
    if (ordinaryDisabled) return;
    if (action === "pi") {
      const current = pi?.release?.token && piReady ? update : await act("pi-check");
      const next = current?.pi;
      if (!next?.release?.token || !next.cli || next.cli.error || next.cli.legacy) {
        if (current) setError({ action: "pi-check", message: next?.cli?.error || (next?.cli?.legacy ? "请先通过原安装方式迁移旧版 Pi。" : "尚未取得可安装的 Pi 版本，请重试。"), neutral: false });
        return;
      }
      const retry = next.cli.repairRequired || current?.job?.kind === "pi" && ["error", "interrupted"].includes(current.job.phase) && next.cli.version === next.release.version;
      if (next.cli.version && !newer(next.release.version, next.cli.version) && !retry) { setError({ action: "pi-check", message: "Pi 已是最新版本。", neutral: true }); return; }
      confirmedPi.current = { token: next.release.token, version: next.release.version, installed: !!next.cli.version, packageRoot: next.cli.packageRoot };
    } else if (action === "service") {
      const current = update?.release ? update : await act("check");
      if (!current) return;
      if (!current.managed) { setError({ action: "check", message: "请使用此服务原来的安装方式更新。", neutral: false }); return; }
      if (!newer(current.release?.version, current.serviceVersion)) { setError({ action: "check", message: "后台服务已是最新版本。", neutral: true }); return; }
      confirmedService.current = current.release!.version;
    } else if (actionDisabled[action]) return;
    setConfirm(action);
  };
  return (
    <section ref={section} tabIndex={-1} className="connect-updates updates-simple" aria-label="版本与更新">
      <h2>更新</h2>
      <section className="update-component" aria-label="后台服务更新">
        <div className="update-component-row">
          <div className="update-component-copy"><h3>后台服务</h3><p>{service?.state === "missing" ? "未安装" : update?.serviceVersion ? `v${update.serviceVersion}` : "正在读取…"}{latest && service?.state !== "missing" && <span>{newer(latest, update?.serviceVersion) ? `可更新至 v${latest}` : "已是最新版本"}</span>}</p></div>
          <div className="connect-actions">
            <button className="connect-secondary" aria-label="检查更新" disabled={ordinaryDisabled} onClick={() => void act("check")}>{busy === "check" ? "正在检查…" : "检查更新"}</button>
            {service?.state === "missing" ? <button className="connect-secondary" disabled={ordinaryDisabled || !onInstallService} onClick={onInstallService}>安装</button> : <button className="connect-secondary" aria-label="更新后台服务" disabled={ordinaryDisabled || !!update?.recovery || !!update && !update.managed || !["running", "stopped"].includes(service?.state || "")} onClick={() => void ask("service")}>更新</button>}
            {update?.recovery && <button className="connect-secondary" disabled={actionDisabled.recover} onClick={() => ask("recover")}>恢复旧版本</button>}
          </div>
        </div>
        {update && !update.managed && service?.state !== "missing" && <p className="connect-update-detail">请使用原安装方式更新此服务。</p>}
        {update?.job && !["pi", "client"].includes(update.job.kind) && progress}
        {error && !historyOpen && !piError && error.message !== update?.job?.message && <p className={error.neutral || running ? "connect-message" : "connect-error"} role={error.neutral || running ? "status" : "alert"}>{error.message}</p>}
      </section>
      <section className="update-component" aria-labelledby="pi-heading" aria-busy={busy?.startsWith("pi") || (running && update?.job?.kind === "pi")}>
        <div className="update-component-row">
          <div className="update-component-copy"><h3 id="pi-heading">Pi 引擎</h3><p>{pi?.cli?.error ? "状态读取失败" : pi?.cli?.legacy ? "需要迁移" : pi?.cli?.version ? `v${pi.cli.version}` : pi?.cli ? "未安装" : "正在读取…"}{pi?.release && <span>{!pi.cli?.version || piNewer ? `可安装 v${pi.release.version}` : piRetry ? "需要重新安装" : "已是最新版本"}</span>}</p></div>
          <div className="connect-actions">
            <button className="connect-secondary" aria-label="检查 Pi 更新" disabled={ordinaryDisabled} onClick={() => void act("pi-check")}>{busy === "pi-check" ? "正在检查…" : "检查更新"}</button>
            <button className="connect-secondary" aria-label={piRetry ? "重新安装终端 Pi" : pi?.cli?.version ? "更新终端 Pi" : "安装终端 Pi"} disabled={ordinaryDisabled} onClick={() => void ask("pi")}>{busy === "pi" || (running && update?.job?.kind === "pi") ? "正在安装…" : piRetry ? "重新安装" : pi?.cli?.version ? "更新" : "安装"}</button>
          </div>
        </div>
        {pi?.cli?.error && !historyOpen && <p className="connect-error" role="alert">{pi.cli.error}<button className="maintenance-text-button" disabled={ordinaryDisabled} onClick={() => void act("pi-refresh")}>重试</button></p>}
        {pi?.cli?.repairRequired && <p className="connect-message">{pi.cli.repairReason || "请检查更新后重新安装。"}</p>}
        {pi?.cli?.legacy && <p className="connect-message">请先通过原安装方式迁移旧版 Pi。</p>}
        {piReady && pi?.release && !pi.release.token && (!pi.cli?.version || piNewer || piRetry) && <p className="connect-update-detail">安装状态已变化，请重新检查更新。</p>}
        {update?.job?.kind === "pi" && progress}
        {error && !historyOpen && piError && error.message !== update?.job?.message && <p className={error.neutral || running ? "connect-message" : "connect-error"} role={error.neutral || running ? "status" : "alert"}>{error.message}</p>}
      </section>
      <section className="update-component" aria-label="客户端更新">
        <div className="update-component-row">
          <div className="update-component-copy"><h3>桌面客户端</h3><p>{update?.clientVersion ? `v${update.clientVersion}` : "正在读取…"}{newer(latest, update?.clientVersion) && <span>可更新至 v{latest}</span>}</p></div>
          <div className="connect-actions">
            {update?.clientSupported && update.release?.assets?.["Axiom2.msi"] && <button className="connect-secondary" aria-label="下载客户端更新" disabled={ordinaryDisabled || !newer(latest, update.clientVersion)} onClick={() => void act("client")}>下载更新</button>}
            {installerReady && <button className="connect-secondary" disabled={actionDisabled.installer} onClick={() => ask("installer")}>安装更新</button>}
          </div>
        </div>
        {update?.job?.kind === "client" && progress}
      </section>
      {(needsReconciliation || update?.job?.servicePending) && <div className="update-recovery" role="status"><p>上次更新尚未完成核实，不会重复安装。</p>{needsReconciliation && update?.job?.task && <button className="connect-secondary" disabled={!!busy || running || serviceBusy || uncertain} onClick={() => void control("reconcile", { id: update.job!.task!.id }).catch(cause => setError({ action: "reconcile", message: String(cause), neutral: true }))}>核实并恢复</button>}</div>}
      <details className="maintenance-details update-details"><summary>更新详情</summary>
        <button className="maintenance-text-button" onClick={() => setHistoryOpen(true)}><Icon name="history" />更新任务记录</button>
        <p className="connect-update-detail">应用内 Pi {pi?.runtimeVersion || "未检测到"} 随后台服务更新；这里的 Pi 安装按钮管理独立终端程序。</p>
        {pi?.cli?.packageRoot && <p className="connect-log">Pi 安装位置：<LocalPath path={pi.cli.packageRoot} onOpen={() => desktopInvoke("axiom_reveal_path", { path: pi.cli!.packageRoot })} /></p>}
        <details className="maintenance-details"><summary>下载与安装设置</summary><BudgetEditor value={update?.budgets ?? defaultMaintenanceBudgets} onSave={budgets => control("defaults", { budgets })} /></details>
        {update?.log && <p className="connect-log">更新日志：<LocalPath path={update.log} onOpen={() => desktopInvoke("axiom_reveal_path", { path: update.log })} /></p>}
      </details>
      {historyOpen && <DesktopTaskCenter kind="update" current={update?.job?.task} onClose={() => setHistoryOpen(false)} onSource={() => { setHistoryOpen(false); window.requestAnimationFrame(() => section.current?.focus()); }} onChanged={() => void act("status", true)} />}
      {confirm && <ConfirmDialog
        title={confirm === "pi" ? `${confirmedPi.current?.installed ? "更新" : "安装"}终端 Pi ${confirmedPi.current?.version}？` : confirm === "installer" ? "打开客户端安装向导？" : confirm === "recover" ? "恢复之前的服务版本？" : `更新后台至 ${confirmedService.current}？`}
        description={confirm === "pi" ? "保留个人设置。请先结束使用此安装的 Pi 终端会话，完成后重新打开。" : confirm === "installer" ? "安装包已经校验。将关闭本客户端并打开安装向导，后台服务继续运行。" : "将停止本机后台及其正在执行的任务，保留项目和会话。请先保存工作。"}
        warning={confirm !== "installer" && confirm !== "pi" ? "此功能要求当前数据目录独占此安装；共用安装请使用原安装方式更新。" : undefined}
        danger={confirm === "service" || confirm === "recover"} confirmDisabled={confirmationDisabled(confirm)}
        cancelLabel={confirm === "service" ? "暂不更新" : "取消"}
        confirmLabel={confirm === "pi" ? confirmedPi.current?.installed ? "确认更新 Pi" : "确认安装 Pi" : confirm === "installer" ? "打开安装向导" : confirm === "recover" ? "确认恢复" : "确认更新服务"}
        onClose={() => setConfirm(null)} onConfirm={() => { setConfirm(null); void act(confirm); }}>
        {confirm === "pi" && confirmedPi.current?.packageRoot && <p className="confirm-location">安装位置：<LocalPath path={confirmedPi.current.packageRoot} onOpen={() => desktopInvoke("axiom_reveal_path", { path: confirmedPi.current!.packageRoot })} /></p>}
        {confirm !== "installer" && confirm !== "pi" && !!service?.active.length && <details><summary>受影响的会话 · {service.active.length}</summary><ul>{service.active.map((title, index) => <li key={index}>{title || "未命名会话"}</li>)}</ul></details>}
      </ConfirmDialog>}
    </section>
  );
}
