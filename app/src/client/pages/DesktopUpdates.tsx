import { DesktopTaskCenter } from "../maintenance/DesktopTaskCenter.js";
import { Icon } from "../Icon.js";
import { BudgetEditor, MaintenanceTaskView } from "../maintenance/MaintenanceView.js";
import { defaultMaintenanceBudgets, type MaintenanceTask, type MaintenanceBudgets } from "../../shared/maintenance.js";
import { useEffect, useRef, useState } from "react";
import { LocalPath } from "../LocalPath.js";
import { desktopInvoke } from "./desktop-bridge.js";
import { IconButton } from "./StartupControls.js";
import InstallProgress from "./InstallProgress.js";

type UpdateAction = "status" | "check" | "pi-check" | "pi-refresh" | "pi" | "service" | "client" | "recover" | "installer" | "cancel" | "extend" | "defaults" | "reconcile";
type Update = {
  pi?: { runtimeVersion: string | null; cli: { version?: string | null; packageRoot?: string; error?: string; legacy?: boolean } | null; release: { version: string; checkedAt: number; token: string | null } | null };
  clientVersion: string; serviceVersion: string | null; managed: boolean; clientSupported: boolean;
  release: { version: string; checkedAt: number; assets: Record<string, { url: string }> } | null;
  budgets?: MaintenanceBudgets;
  job: { task?: MaintenanceTask; kind: string; version?: string; running: boolean; phase: string; message: string; download?: unknown; updatedAt?: number } | null;
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
  if (action !== "installer" && (!result || typeof result.clientVersion !== "string")) throw Error("更新状态不完整，请重新读取。");
  return result;
}
export default function DesktopUpdates({ service, serviceBusy, onBusyChange, onAvailableChange, onServiceChange }: {
  service: { state: string; active: string[] } | null; serviceBusy: boolean;
  onBusyChange: (busy: boolean) => void; onAvailableChange: (available: boolean) => void; onServiceChange: () => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const section = useRef<HTMLElement>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [busy, setBusy] = useState<UpdateAction | null>(null);
  const [error, setError] = useState<{ action: UpdateAction; message: string } | null>(null);
  const [confirm, setConfirm] = useState<"service" | "recover" | "installer" | "pi" | null>(null);
  const confirmedPi = useRef<{ token: string; version: string; installed: boolean; packageRoot?: string } | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const requested = useRef(false);
  const previousRunning = useRef(false);
  const manualError = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const latest = update?.release?.version;
  const running = !!update?.job?.running;
  const backendBusy = (running && update?.job?.kind !== "client") || busy === "service" || busy === "recover" || busy === "pi";
  const disabled = !!busy || running || serviceBusy;
  const pi = update?.pi;
  const piNewer = newer(pi?.release?.version, pi?.cli?.version);
  const piReady = !!pi?.cli && !pi.cli.error && !pi.cli.legacy;
  const piRetry = update?.job?.kind === "pi" && ["error", "interrupted"].includes(update.job.phase) && pi?.cli?.version === pi?.release?.version;
  const piError = error?.action.startsWith("pi");
  const progress = <>{update?.job?.task ? <MaintenanceTaskView task={update.job.task} onReconcile={() => control("reconcile", { id: update.job!.task!.id })} showError={!historyOpen} connected onCancel={() => control("cancel", { id: update.job!.task!.id })} onExtend={budgets => control("extend", { id: update.job!.task!.id, budgets })} /> : update?.job && <><p className={`connect-update-progress ${update.job.phase === "error" || update.job.phase === "interrupted" ? "has-error" : ""}`} role="status" aria-live="polite">{running && <span className="connect-update-pulse" aria-hidden="true" />}{update.job.message}</p><InstallProgress value={update.job.download} running={running}  /></>}{update?.job?.kind === "pi" && <>{running && <p className="connect-footnote">{update.execution?.updatedAt ? `最近日志输出于 ${Math.max(0, Math.floor((Date.now() - update.execution.updatedAt) / 1000))} 秒前；无新输出不代表下载已停止。` : "等待 npm 输出；安装期间无法计算整体百分比。"}</p>}{!!update.execution?.lines.length && <details open={running || update.job.phase === "error"}><summary>执行详情</summary><pre className="connect-update-log">{update.execution.lines.join("\n")}</pre></details>}</>}</>;
  async function control(action: UpdateAction, payload: Record<string, unknown>) {
    const result = await invoke(action, JSON.stringify(payload)); setUpdate(result);
  }
  async function act(action: UpdateAction, quiet = false) {
    if (quiet ? pending.current || requested.current : requested.current) return;
    // Reserve manual actions while a status poll finishes, including confirmed installs.
    if (!quiet) { requested.current = true; setBusy(action); setError(null); manualError.current = false; }
    if (pending.current) await pending.current;
    if (action === "service" || action === "recover" || action === "pi") onBusyChange(true);
    const request = (async () => {
      try {
        const result = await invoke(action, action === "pi" ? confirmedPi.current?.token : action === "service" || action === "client" ? latest : undefined);
        if (action === "installer") return;
        setUpdate(result);
        if (previousRunning.current && !result.job?.running) onServiceChange();
        previousRunning.current = !!result.job?.running;
        if (!quiet || !manualError.current) setError(null);
      } catch (cause) {
        if (!quiet) manualError.current = true;
        if (!quiet || !manualError.current) setError({ action, message: cause instanceof Error ? cause.message : String(cause) });
      }
    })();
    pending.current = request;
    try { await request; }
    finally { if (pending.current === request) pending.current = null; if (!quiet) { requested.current = false; setBusy(null); } }
  }
  useEffect(() => {
    void act("pi-refresh");
    const timer = window.setInterval(() => { void act("status", true); }, 2000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { onBusyChange(backendBusy); }, [backendBusy, onBusyChange]);
  const available = newer(latest, update?.serviceVersion) || newer(latest, update?.clientVersion) || (piReady && piNewer);
  useEffect(() => { onAvailableChange(available); }, [available, onAvailableChange]);
  useEffect(() => {
    if (confirm) dialog.current?.showModal();
    else if (dialog.current?.open) { dialog.current.close(); trigger.current?.focus(); }
  }, [confirm]);
  const ask = (action: "service" | "recover" | "installer" | "pi") => {
    if (action === "pi") {
      if (!pi?.release?.token || !piReady) return;
      confirmedPi.current = { token: pi.release.token, version: pi.release.version, installed: !!pi.cli?.version, packageRoot: pi.cli?.packageRoot };
    }
    trigger.current = document.activeElement as HTMLElement;
    setConfirm(action);
  };
  return (
    <section ref={section} tabIndex={-1} className="connect-updates" aria-label="版本与更新">
      <div className="connect-updates-heading"><div><p className="connect-eyebrow">保持就绪</p><h2>版本与更新</h2></div><IconButton label="检查更新" icon="refresh-cw" spinning={busy === "check"} disabled={disabled} onClick={() => void act("check")} /></div>
      <button className="maintenance-text-button" onClick={() => setHistoryOpen(true)}><Icon name="history" />更新任务记录</button>
      <dl className="connect-versions"><div><dt>桌面客户端</dt><dd>{update?.clientVersion || "—"}</dd></div><div><dt>后台服务</dt><dd>{update?.serviceVersion || "—"}</dd></div><div><dt>最新版本</dt><dd>{latest || "尚未检查"}</dd></div></dl>
      <p className="connect-update-detail">后台更新会结束当前任务、保留项目与会话记录。安装包准备好后再切换版本，更新任务会在关闭客户端后继续。</p>
      {service?.state === "missing" ? <p className="connect-message">后台尚未安装；终端 Pi 只需 Node.js 22.19.0+ 与 npm，可独立安装或更新。</p> : update && !update.managed && <p className="connect-message">当前服务不是标准安装，请使用原安装方式更新后台。</p>}
      {update?.release && !newer(latest, update.serviceVersion) && !newer(latest, update.clientVersion) && <p className="connect-update-current">已是最新版本。</p>}
      {update?.job?.kind !== "pi" && progress}
      {error && !historyOpen && !piError && error.message !== update?.job?.message && <p className="connect-error" role="alert">{error.message}</p>}
      <div className="connect-actions">
        <button className="connect-secondary" disabled={disabled || !update?.managed || update.recovery || !newer(latest, update.serviceVersion) || !["running", "stopped"].includes(service?.state || "")} onClick={() => ask("service")}>更新后台服务{newer(latest, update?.serviceVersion) ? ` · ${latest}` : ""}</button>
        {update?.clientSupported && update.release?.assets?.["Axiom2.msi"] && <button className="connect-secondary" disabled={disabled || !newer(latest, update.clientVersion)} onClick={() => void act("client")}>下载客户端更新</button>}
        {update?.job?.kind === "client" && update.job.phase === "ready" && <button className="connect-secondary" disabled={disabled} onClick={() => ask("installer")}>运行安装器</button>}
        {update?.recovery && <button className="connect-secondary" disabled={disabled} onClick={() => ask("recover")}>恢复旧版本</button>}
      </div>
      <section className="connect-pi" aria-labelledby="pi-heading" aria-busy={busy?.startsWith("pi") || (running && update?.job?.kind === "pi")}>
        <div className="connect-updates-heading"><h3 id="pi-heading">Pi 引擎</h3><IconButton label="刷新 Pi 安装状态" icon="refresh-cw" spinning={busy === "pi-refresh"} disabled={disabled} onClick={() => void act("pi-refresh")} /></div>
        <dl className="connect-versions"><div><dt>应用内 Pi</dt><dd>{pi?.runtimeVersion || (service?.state === "missing" ? "后台未安装" : update ? "未检测到" : "正在读取…")}</dd></div><div><dt>终端 Pi</dt><dd>{pi?.cli ? pi.cli.error ? "读取失败" : pi.cli.legacy ? "需迁移" : pi.cli.version || "未安装" : busy === "pi-refresh" ? "正在读取…" : "尚未读取"}</dd></div><div><dt>最新稳定版</dt><dd>{pi?.release?.version || "尚未检查"}</dd></div></dl>
        <p className="connect-update-detail">应用内 Pi 随后台服务更新。终端 Pi 可在此单独安装或更新，完成后重新打开终端会话即可使用。</p>
        {pi?.cli?.error && !historyOpen && <p className="connect-error" role="alert">{pi.cli.error}</p>}
        {pi?.cli?.legacy && <p className="connect-message">检测到旧版终端 Pi，请先通过原安装方式迁移，再刷新安装状态。</p>}
        {piReady && !pi?.release && <p className="connect-update-detail">先检查 Pi 更新，获取可安装的最新稳定版本。</p>}
        {piReady && pi?.release && !pi.cli?.version && <p className="connect-update-detail">尚未安装终端 Pi，可安装 {pi.release.version}。</p>}
        {piReady && pi?.release && pi.cli?.version && !piNewer && !piRetry && <p className="connect-update-current">{newer(pi.cli.version, pi.release.version) ? "终端 Pi 已安装的版本高于最新稳定版。" : "终端 Pi 已是最新版本。"}</p>}
        {piReady && pi?.release && !pi.release.token && (!pi.cli?.version || piNewer || piRetry) && <p className="connect-update-detail">安装状态已变化，请先重新检查 Pi 更新，再确认安装。</p>}
        {update?.job?.kind === "pi" && progress}
        {error && !historyOpen && piError && error.message !== update?.job?.message && <p className="connect-error" role="alert">{error.message}</p>}
        <div className="connect-actions">
          <button className="connect-secondary" disabled={disabled} onClick={() => void act("pi-check")}>{busy === "pi-check" ? "正在检查…" : "检查 Pi 更新"}</button>
          <button className="connect-secondary" disabled={disabled || !pi?.release?.token || !piReady || (!!pi.cli?.version && !piNewer && !piRetry)} onClick={() => ask("pi")}>{busy === "pi" || (running && update?.job?.kind === "pi") ? "正在安装…" : piRetry ? "重新安装终端 Pi" : pi?.cli?.version ? "更新终端 Pi" : "安装终端 Pi"}{pi?.release && (!pi.cli?.version || piNewer) ? ` · ${pi.release.version}` : ""}</button>
        </div>
        {pi?.cli?.packageRoot && <details className="connect-pi-location"><summary>终端安装位置</summary><p className="connect-log"><LocalPath path={pi.cli.packageRoot} onOpen={() => desktopInvoke("axiom_reveal_path", { path: pi.cli!.packageRoot })} /></p><p className="connect-update-detail">使用本机检测到的 Node.js 对应的 npm 全局目录；已有后台时沿用其 Node.js。</p></details>}
      </section>
      <details className="maintenance-details"><summary>桌面下载与安装超时设置</summary><BudgetEditor value={update?.budgets ?? defaultMaintenanceBudgets} onSave={budgets => control("defaults", { budgets })} /></details>
      <p className="connect-update-detail">桌面客户端、Node.js、Tailscale 与终端 Pi 使用系统或原包管理器卸载；应用内 Pi 随后台版本管理。</p>
      {update?.log && <p className="connect-log">更新日志：<LocalPath path={update.log} onOpen={() => desktopInvoke("axiom_reveal_path", { path: update.log })} /></p>}
      {historyOpen && <DesktopTaskCenter kind="update" current={update?.job?.task} onClose={() => setHistoryOpen(false)} onSource={() => { setHistoryOpen(false); window.requestAnimationFrame(() => section.current?.focus()); }} onChanged={() => void act("status", true)} />}
      <dialog ref={dialog} className="connect-dialog" onCancel={() => setConfirm(null)} onClose={() => setConfirm(null)} aria-labelledby="update-title">
        <h2 id="update-title">{confirm === "pi" ? `${confirmedPi.current?.installed ? "更新" : "安装"}终端 Pi ${confirmedPi.current?.version}？` : confirm === "installer" ? "打开客户端安装向导？" : confirm === "recover" ? "恢复之前的服务版本？" : `更新后台至 ${latest}？`}</h2>
        <p>{confirm === "pi" ? "将安装所选版本的终端 Pi，保留模型、认证、技能和 MCP 配置。请先结束正在使用此安装的终端 Pi 会话，完成后重新打开。应用内 Pi 随后台服务更新。" : confirm === "installer" ? "安装包已经校验。打开安装向导后，本客户端会关闭，后台服务继续运行。请按向导完成安装，再打开 Axiom2。" : "受管理后台正在运行的任务将结束，其工作台视图会关闭；直接连接的开发或远程工作台保留。项目和会话数据会保留；程序切换失败会尝试恢复旧版本。请先保存需要保留的工作。"}</p>
        {confirm === "pi" && confirmedPi.current?.packageRoot && <p className="connect-log">安装位置：<LocalPath path={confirmedPi.current.packageRoot} onOpen={() => desktopInvoke("axiom_reveal_path", { path: confirmedPi.current!.packageRoot })} /></p>}
        {confirm !== "installer" && confirm !== "pi" && <p>应用内更新与恢复要求此安装仅用于当前数据目录。多个数据目录共用安装时，请停止所有相关服务并使用原安装方式更新；各数据目录使用独立安装目录后才能使用此功能。</p>}
        {confirm !== "installer" && confirm !== "pi" && !!service?.active.length && <ul>{service.active.map((title, index) => <li key={index}>{title || "未命名会话"}</li>)}</ul>}
        <div className="connect-dialog-actions"><button className="connect-secondary" autoFocus onClick={() => setConfirm(null)}>{confirm === "pi" ? "取消" : "暂不更新"}</button><button className="connect-primary" onClick={() => { const action = confirm; setConfirm(null); if (action) void act(action); }}>{confirm === "pi" ? confirmedPi.current?.installed ? "确认更新 Pi" : "确认安装 Pi" : confirm === "installer" ? "打开安装向导" : confirm === "recover" ? "确认恢复" : "确认更新服务"}</button></div>
      </dialog>
    </section>
  );
}
