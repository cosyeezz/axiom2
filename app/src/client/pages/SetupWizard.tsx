import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { DesktopTaskCenter } from "../maintenance/DesktopTaskCenter.js";
import { BudgetEditor, MaintenanceTaskView } from "../maintenance/MaintenanceView.js";
import { defaultMaintenanceBudgets, type MaintenanceTask, type MaintenanceBudgets } from "../../shared/maintenance.js";
import { desktopInvoke, DesktopResponsePendingError, isDesktopResponsePending } from "./desktop-bridge.js";
import { Icon } from "../Icon.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import { isSubmissionRefused, validOperationJob } from "./desktop-operation.js";
import InstallProgress from "./InstallProgress.js";
import { CommandLine, IconButton, ResourceLink } from "./StartupControls.js";
type Environment = { nodeReady: boolean; nodeVersion: string; writable: boolean; tailscale: boolean; platform: string };
export type PreparationDetection = { environment: Environment | null; checking: boolean; failed: boolean; attention?: boolean; job?: Job | null; foreground?: boolean; uncertain?: boolean; feedback?: { message: string; neutral: boolean } };
export type SetupControls = { installService: () => void; maintainService: (version?: string) => void; showRuntime: () => void };
const repairable = (job: Job | null | undefined) => job?.repairable === true && job.action === "service" && !job.running;
type Job = { foreground?: boolean; repairable?: boolean; recovery?: { state: string; message?: string }; task?: MaintenanceTask; id?: string; action: string; running: boolean; phase: string; message: string; lines: string[]; progress?: unknown; startedAt?: number; logUpdatedAt?: number; exitCode?: number };
function readJob(value: unknown): Job | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || typeof (value as Job).running !== "boolean" || typeof (value as Job).phase !== "string") throw Error("安装记录不完整，请重新读取状态。");
  const job = value as Job;
  return { ...job, foreground: job.foreground === true, repairable: job.repairable === true, action: typeof job.action === "string" ? job.action : "", message: typeof job.message === "string" ? job.message : "正在核实安装状态", lines: Array.isArray(job.lines) ? job.lines.filter(line => typeof line === "string") : [] };
}
export default function SetupWizard({ remote, service, blocked, onBusy, onComplete, onDetection, controls, children }: { remote: boolean; service: { state: string } | null; blocked: boolean; onBusy: (busy: boolean) => void; onComplete: () => void; onDetection: (detection: PreparationDetection) => void; controls?: Ref<SetupControls>; children?: ReactNode }) {
  const [budgets, setBudgets] = useState(defaultMaintenanceBudgets);
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [checking, setChecking] = useState(true);
  const [checkFailed, setCheckFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [autoInstalling, setAutoInstalling] = useState(false);
  const installFlow = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const unconfirmed = useRef<{ action: string; previousId?: string; startedAt: number; request: number } | null>(null);
  const submission = useRef(0);
  const [error, setError] = useState("");
  const [readWarning, setReadWarning] = useState(true);
  const [statusUnknown, setStatusUnknown] = useState(true);
  useEffect(() => { onDetection({ environment, checking, failed: checkFailed, attention: !repairable(job) && (job?.phase === "interrupted" || job?.task?.status === "unknown" || job?.task?.status === "interrupted") || uncertain || statusUnknown && !checking, foreground: job?.foreground || repairable(job), job, uncertain, feedback: error ? { message: error, neutral: readWarning || uncertain || !!job?.running } : undefined }); }, [environment, checking, checkFailed, onDetection, job, uncertain, error, readWarning, statusUnknown]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const workflow = useRef<HTMLElement>(null);
  const [confirmRecovery, setConfirmRecovery] = useState(false);
  const [confirmReinstall, setConfirmReinstall] = useState(false);
  const windows = /Win/i.test(navigator.platform);
  const pending = useRef(false), alive = useRef(true), jobEpoch = useRef(0), checkEpoch = useRef(0);
  const wasRunning = useRef(false);
  const latestJob = useRef<Job | null>(null);
  const statusRead = useRef<Promise<Job | null> | null>(null);
  const callbacks = useRef({ onBusy, onComplete }); callbacks.current = { onBusy, onComplete };
  const command = windows ? "irm https://raw.githubusercontent.com/cosyeezz/axiom2/master/install.ps1 | iex" : "curl -fsSL https://raw.githubusercontent.com/cosyeezz/axiom2/master/install.sh | sh";
  async function check() {
    const epoch = ++checkEpoch.current; setChecking(true); setCheckFailed(false); setError(""); setReadWarning(true);
    try {
      const next = await desktopInvoke<Environment>("axiom_setup", { action: "check" });
      if (!next || typeof next.nodeReady !== "boolean" || typeof next.writable !== "boolean" || typeof next.tailscale !== "boolean") throw Error("环境检测结果不完整，请重新验证。");
      if (alive.current && epoch === checkEpoch.current) setEnvironment(next);
      return next;
    } catch (cause) { if (alive.current && epoch === checkEpoch.current) { setCheckFailed(true); setError(String(cause instanceof Error ? cause.message : cause)); } }
    finally { if (alive.current && epoch === checkEpoch.current) setChecking(false); }
  }
  async function status(): Promise<Job | null> {
    if (pending.current) return latestJob.current;
    if (statusRead.current) return statusRead.current;
    const epoch = jobEpoch.current;
    const reading = (async () => {
      try {
        const result = await desktopInvoke<{ job: unknown; budgets?: MaintenanceBudgets }>("axiom_setup", { action: "status" });
        if (!alive.current || epoch !== jobEpoch.current) return latestJob.current;
        if (!result || !("job" in result)) throw Error("安装状态未能读取，请重试。");
        const next = readJob(result.job);
        if (next && !validOperationJob(next, "action")) { setJob({ ...next, task: undefined }); throw Error("安装记录不完整，已保留原任务身份；请先核实原任务。"); }
        latestJob.current = next; setJob(next); setStatusUnknown(false);
        if (result.budgets) setBudgets(result.budgets);
        const waiting = unconfirmed.current;
        if (waiting && next && next.action === waiting.action && (next.id || next.task?.id) !== waiting.previousId && (next.startedAt ?? next.task?.createdAt ?? 0) >= waiting.startedAt) { unconfirmed.current = null; setUncertain(false); setError(""); }
        if (wasRunning.current && !next?.running) { void check(); callbacks.current.onComplete(); }
        wasRunning.current = !!next?.running;
        return next;
      } catch (cause) {
        if (!alive.current || epoch !== jobEpoch.current) return latestJob.current;
        setStatusUnknown(true); setReadWarning(true); throw cause;
      }
    })();
    statusRead.current = reading;
    try { return await reading; }
    finally { if (statusRead.current === reading) statusRead.current = null; }
  }
  useEffect(() => {
    alive.current = true; void check(); let timer: number;
    const poll = async () => { const observed = jobEpoch.current; try { await status(); } catch (cause) { if (alive.current && observed === jobEpoch.current) { setReadWarning(true); setError(String(cause instanceof Error ? cause.message : cause)); } } if (alive.current) timer = window.setTimeout(() => void poll(), 1500); };
    void poll(); return () => { alive.current = false; ++checkEpoch.current; ++jobEpoch.current; window.clearTimeout(timer); };
  }, []);
  const running = !!job?.running;
  useEffect(() => { callbacks.current.onBusy(running || submitting || uncertain || autoInstalling); }, [running, submitting, uncertain, autoInstalling]);
  async function action(name: string, targetId?: string, reinstall = false, targetVersion?: string) {
    if (pending.current || unconfirmed.current) return;
    let acceptedJob: Job | null | undefined;
    const request = ++submission.current;
    const attempt = { action: name, previousId: job?.id || job?.task?.id, startedAt: Date.now(), request };
    pending.current = true; ++jobEpoch.current; setSubmitting(true); setError(""); setReadWarning(false);
    const accept = (result: { job?: unknown }) => {
      if (!alive.current || request !== submission.current) return;
      ++jobEpoch.current;
      if (["node", "service", "tailscale"].includes(name) && (!validOperationJob(result?.job, "action") || (result?.job as Job).action !== name)) throw new DesktopResponsePendingError("安装响应不完整，结果尚未确认，正在核实。");
      if (result?.job) { const next = readJob(result.job); acceptedJob = next; latestJob.current = next; setJob(next); setStatusUnknown(false); wasRunning.current = !!next?.running; }
      unconfirmed.current = null; setUncertain(false); setError("");
      if (name === "reconcile-service") { void check(); callbacks.current.onComplete(); }
    };
    try {
      const result = await desktopInvoke<{ job?: unknown }>("axiom_setup", { action: name, confirmed: name === "acknowledge-interruption" || name === "service" && reinstall, ...(name === "reconcile-service" ? { maintenance: { id: targetId || job?.id } } : name === "service" && targetVersion ? { maintenance: { version: targetVersion } } : {}) });
      accept(result);
    } catch (cause) {
      if (alive.current) {
        const message = String(cause instanceof Error ? cause.message : cause);
        setError(message);
        if (isDesktopResponsePending(cause) && ["node", "service", "tailscale"].includes(name)) {
          unconfirmed.current = attempt; setUncertain(true);
          // Keep observing this exact invocation; never replay an installation.
          if (cause instanceof DesktopResponsePendingError && cause.response) {
            const rejectLate = (failure: unknown) => {
              if (!alive.current || unconfirmed.current !== attempt) return;
              const refused = isSubmissionRefused(failure);
              if (refused) { unconfirmed.current = null; setUncertain(false); }
              setReadWarning(!refused);
              setError(refused ? (failure instanceof Error ? failure.message : String(failure)) : "原安装请求结果尚未确认，正在核实，请勿重复安装。");
            };
            void cause.response.then(value => {
              if (!alive.current || unconfirmed.current !== attempt) return;
              try { accept(value as { job?: unknown }); } catch (failure) { rejectLate(failure); }
            }, rejectLate);
          }
        }
      }
    } finally { ++jobEpoch.current; pending.current = false; if (alive.current) setSubmitting(false); }
    return acceptedJob;
  }
  async function installService(reinstall = false, targetVersion?: string) {
    if (installFlow.current || pending.current || unconfirmed.current || blocked || running) return;
    installFlow.current = true; setAutoInstalling(true); setError("");
    const pause = () => new Promise<void>(resolve => window.setTimeout(resolve, 1500));
    try {
      let current: Job | null | undefined = await status();
      if (current === undefined) throw Error("暂未读到安装状态，请重试安装。");
      // Complete an already-exited attempt first, without replaying its writes.
      while (current?.recovery?.state === "checking" && !repairable(current)) {
        await pause(); if (!alive.current) return;
        current = await status();
      }
      if (current?.phase === "interrupted" && !repairable(current)) {
        if (current.action !== "service") { setConfirmRecovery(true); throw Error("请先确认上次系统安装器已退出，然后重新点击安装。"); }
        current = await action("reconcile-service", current.id);
        if (!current || current.phase === "interrupted" || current.running) return;
      }
      let runtime = await check();
      if (!runtime) return;
      if (!runtime.writable) throw Error("安装目录不可写，请检查目录权限后重试。");
      if (!runtime.nodeReady) {
        const submittedAt = Date.now(), previousId = current?.id;
        let node = await action("node");
        if (!node && !unconfirmed.current) return;
        const expectedId = node?.id;
        for (;;) {
          if (!alive.current) return;
          if (node && node.action === "node" && (expectedId ? node.id === expectedId : node.id !== previousId && (node.startedAt ?? node.task?.createdAt ?? 0) >= submittedAt)) {
            if (!node.running) {
              if (node.phase !== "done" || node.task?.status !== "succeeded") throw Error(node.message || "运行环境未安装完成，请重试。");
              break;
            }
          } else if (expectedId && node) throw Error("安装任务已变化，请重新读取当前任务。");
          else if (!unconfirmed.current) return;
          await pause();
          node = await status();
        }
        runtime = await check();
        if (!runtime) return;
        if (!runtime.nodeReady) throw Error("Node.js 安装后尚未就绪，请重新打开客户端再安装。");
      }
      if (alive.current) await action("service", undefined, reinstall, targetVersion);
    } catch (cause) { if (alive.current) { setReadWarning(false); setError(cause instanceof Error ? cause.message : String(cause)); } }
    finally { installFlow.current = false; if (alive.current) setAutoInstalling(false); }
  }
  async function control(action: string, maintenance: Record<string, unknown>) {
    const result = await desktopInvoke<{ job?: unknown; budgets?: MaintenanceBudgets }>("axiom_setup", { action, maintenance });
    if (alive.current) { if (result.budgets) setBudgets(result.budgets); await status(); }
  }
  const interrupted = !repairable(job) && (job?.phase === "interrupted" || job?.task?.status === "unknown" || job?.task?.status === "interrupted");
  useEffect(() => {
    if (!interrupted) setConfirmRecovery(false);
  }, [interrupted]);
  const disabled = running || interrupted || uncertain || statusUnknown || submitting || autoInstalling || blocked;
  useImperativeHandle(controls, () => ({
    installService: () => { if (service?.state === "missing") void installService(); },
    maintainService: version => { void installService(true, version); },
    showRuntime: () => { if (checkFailed || !environment) void check(); requestAnimationFrame(() => workflow.current?.focus()); },
  }));
  const recovering = job?.recovery?.state === "checking";
  return <section ref={workflow} tabIndex={-1} className="setup-simple" aria-label={remote ? "远程连接准备" : "本地连接准备"}>
    <div className="update-component-row">
      <div className="update-component-copy"><h3>{remote ? "Tailscale" : "运行环境"}</h3><p>{checking ? "正在检查…" : remote ? environment?.tailscale ? "已安装" : "未安装" : environment?.nodeReady ? `${environment.nodeVersion || "Node.js"} · npm 已就绪` : "需要 Node.js 22.19.0+ 与 npm"}</p></div>
      <div className="connect-actions"><button className="connect-secondary" disabled={checking || running || submitting || autoInstalling} onClick={() => void check()}>检查</button>
        {!(remote ? environment?.tailscale : environment?.nodeReady) && <button className="connect-secondary" disabled={disabled || checking || !environment} onClick={() => void action(remote ? "tailscale" : "node")}>{submitting ? "正在安装…" : "安装"}</button>}
        {remote && environment?.tailscale && <button className="connect-secondary" disabled={submitting} onClick={() => void action("launch-tailscale")}>打开</button>}
        {!remote && service?.state !== "missing" && <button className="connect-secondary" disabled={disabled || checking || !environment} onClick={() => setConfirmReinstall(true)}>重新安装服务</button>}
      </div>
    </div>
    {!remote && environment && !environment.writable && <p className="connect-error" role="alert">安装目录不可写，请检查目录权限。</p>}
    {job?.task && !interrupted && (running || job.phase === "error") && <MaintenanceTaskView compact task={job.task} showError={!historyOpen} onCancel={() => control("cancel", { id: job.id })} onExtend={budgets => control("extend", { id: job.id, budgets })} />}
    {(running || job?.phase === "error" && !job.task || interrupted || uncertain || statusUnknown) && <div id="setup-recovery" tabIndex={-1} className={`setup-job ${job?.phase === "error" && !running && !interrupted ? "has-error" : ""}`} role="status">
      <div>{(running || recovering) && <Icon name="loader-circle" className="startup-spin" />}<span>{recovering ? "正在核实上次安装，完成后恢复安装入口…" : uncertain ? "正在核实安装结果，请勿重复安装。" : statusUnknown ? "安装记录暂未核实，请重试。" : job?.message}</span><IconButton label="重新读取安装进度" icon="refresh-cw" onClick={() => void status().catch(cause => setError(String(cause)))} /></div>
      {!job?.task && <InstallProgress value={job?.progress} running={running} />}
      {job?.recovery?.message && <p className="connect-message">{job.recovery.message}</p>}
    </div>}
    {interrupted && !running && (job?.action === "service" ? <div className="startup-step-actions">{(windows || environment?.platform === "windows") && <button className="connect-primary" disabled={submitting || uncertain || recovering} onClick={() => void action("reconcile-service")}><Icon name={recovering ? "loader-circle" : "refresh-cw"} className={recovering ? "startup-spin" : ""} />{submitting || recovering ? "正在核实安装…" : "核实并恢复安装"}</button>}<p className="connect-footnote">核实退出后恢复安装入口，不会自动重装或停止后台。</p></div> : <button className="connect-secondary" disabled={submitting || uncertain} onClick={() => setConfirmRecovery(true)}>确认安装器退出后恢复</button>)}
    {error && !historyOpen && <p className={readWarning || uncertain || checking || checkFailed || running ? "connect-message" : "connect-error"} role={readWarning || uncertain || checking || checkFailed || running ? "status" : "alert"}>{error}</p>}
    {running && <p className="connect-footnote">{job?.foreground ? "安装在可见终端执行；可查看实际进度和错误，服务会在独立前台窗口运行。" : "安装在后台继续；请完成系统请求的授权。"}</p>}
    <details className="maintenance-details setup-details"><summary>安装详情</summary>
      <button className="maintenance-text-button" onClick={() => setHistoryOpen(true)}><Icon name="history" />安装任务记录</button>
      {!!job?.lines.length && <details><summary>执行日志</summary><pre>{job.lines.join("\n").replaceAll("@@phase:", "")}</pre></details>}
      <details className="maintenance-details"><summary>下载与安装设置</summary><BudgetEditor value={budgets} onSave={budgets => control("defaults", { budgets })} /></details>
      <details className="startup-manual"><summary>手动安装</summary>
        <CommandLine label={remote ? "Tailscale 安装命令" : "Node.js 安装命令"} command={windows ? remote ? "winget install --id Tailscale.Tailscale --exact" : "winget install --id OpenJS.NodeJS.LTS --exact" : remote ? "brew install --cask tailscale" : "brew install node"} />
        <ResourceLink label={remote ? "Tailscale 下载地址" : "Node.js 下载地址"} url={remote ? "https://tailscale.com/download" : "https://nodejs.org/en/download"} onOpen={() => void action(remote ? "open-tailscale" : "open-node")} />
        {!remote && <><CommandLine label="后台安装命令" command={command} /><ResourceLink label="服务下载地址" url="https://github.com/cosyeezz/axiom2/releases/latest" /></>}
        {children}
      </details>
    </details>
    {historyOpen && <DesktopTaskCenter kind="setup" current={job?.task} onClose={() => setHistoryOpen(false)} onSource={() => { setHistoryOpen(false); window.requestAnimationFrame(() => workflow.current?.focus()); }} onChanged={() => { void status().catch(cause => setError(String(cause))); }} />}
    {confirmReinstall && <ConfirmDialog title="前台重新安装服务？" danger
      description="会先尝试正常关闭自管服务（正在执行的后台任务会中断），只清理确认属于 Axiom 的程序目录；清理失败则换新目录。项目、会话、模型设置与凭据保留。安装与服务均在可见终端执行。"
      confirmLabel="前台重新安装" confirmDisabled={disabled} onClose={() => setConfirmReinstall(false)}
      onConfirm={() => { setConfirmReinstall(false); void installService(true); }} />}
    {confirmRecovery && interrupted && <ConfirmDialog title="确认安装器已退出？" danger
      description="请先确认本次系统安装器已经全部退出。仍在运行时解除占用可能导致重复安装。"
      confirmLabel="我已确认安装器全部退出" confirmDisabled={submitting || blocked || uncertain || !interrupted}
      onClose={() => setConfirmRecovery(false)} onConfirm={() => { setConfirmRecovery(false); void action("acknowledge-interruption"); }} />}
  </section>;
}
