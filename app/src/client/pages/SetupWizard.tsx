import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { BudgetEditor, MaintenanceTaskView } from "../maintenance/MaintenanceView.js";
import { DesktopUnresolvedTasks, useDesktopMaintenanceHistory } from "../maintenance/DesktopMaintenanceHistory.js";
import { defaultMaintenanceBudgets, type MaintenanceTask, type MaintenanceBudgets } from "../../shared/maintenance.js";
import { desktopInvoke, DesktopResponsePendingError, isDesktopResponsePending } from "./desktop-bridge.js";
import { Icon } from "../Icon.js";
import { ComponentAction, ComponentCard, ComponentConfirmation as ConfirmDialog } from "../maintenance/ComponentCard.js";
import { isSubmissionRefused, validOperationJob } from "./desktop-operation.js";
import InstallProgress from "./InstallProgress.js";
import { CommandLine, ResourceLink } from "./StartupControls.js";
type Environment = { nodeReady: boolean; nodeVersion: string; writable: boolean; tailscale: boolean; platform: string };
type SetupComponent = "node" | "tailscale" | "service";
const setupOwner = (action?: string): SetupComponent => action?.includes("tailscale") ? "tailscale" : action?.includes("node") ? "node" : "service";
export type PreparationDetection = { environment: Environment | null; checking: boolean; failed: boolean; attention?: boolean; job?: Job | null; foreground?: boolean; uncertain?: boolean; feedback?: { message: string; neutral: boolean } };
export type SetupControls = { installService: () => void; maintainService: (version?: string, requireLatest?: boolean) => void; showRuntime: () => void };
const repairable = (job: Job | null | undefined) => job?.repairable === true && job.action === "service" && !job.running;
type Job = { foreground?: boolean; repairable?: boolean; recovery?: { state: string; message?: string }; task?: MaintenanceTask; id?: string; action: string; running: boolean; phase: string; message: string; lines: string[]; progress?: unknown; startedAt?: number; logUpdatedAt?: number; exitCode?: number };
function readJob(value: unknown): Job | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || typeof (value as Job).running !== "boolean" || typeof (value as Job).phase !== "string") throw Error("安装记录不完整，请重新读取状态。");
  const job = value as Job;
  return { ...job, foreground: job.foreground === true, repairable: job.repairable === true, action: typeof job.action === "string" ? job.action : "", message: typeof job.message === "string" ? job.message : "正在核实安装状态", lines: Array.isArray(job.lines) ? job.lines.filter(line => typeof line === "string") : [] };
}
export default function SetupWizard({ remote, service, blocked, onBusy, onComplete, onDetection, controls, children }: { remote: boolean; service: { state: string } | null; blocked: boolean; onBusy: (busy: boolean) => void; onComplete: () => void; onDetection: (detection: PreparationDetection) => void; controls?: Ref<SetupControls>; children?: ReactNode }) {
  const history = useDesktopMaintenanceHistory("setup");
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
  const [errorOwner, setErrorOwner] = useState<SetupComponent>(remote ? "tailscale" : "node");
  const [readWarning, setReadWarning] = useState(true);
  const [statusUnknown, setStatusUnknown] = useState(true);
  useEffect(() => { onDetection({ environment, checking, failed: checkFailed, attention: !repairable(job) && (job?.phase === "interrupted" || job?.task?.status === "unknown" || job?.task?.status === "interrupted") || uncertain || statusUnknown && !checking, foreground: job?.foreground || repairable(job), job, uncertain, feedback: error ? { message: error, neutral: readWarning || uncertain || !!job?.running } : undefined }); }, [environment, checking, checkFailed, onDetection, job, uncertain, error, readWarning, statusUnknown]);
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
  async function check(owner: SetupComponent = remote ? "tailscale" : "node") {
    const epoch = ++checkEpoch.current; setChecking(true); setCheckFailed(false); setError(""); setReadWarning(true);
    try {
      const next = await desktopInvoke<Environment>("axiom_setup", { action: "check" });
      if (!next || typeof next.nodeReady !== "boolean" || typeof next.writable !== "boolean" || typeof next.tailscale !== "boolean") throw Error("环境检测结果不完整，请重新验证。");
      if (alive.current && epoch === checkEpoch.current) setEnvironment(next);
      return next;
    } catch (cause) { if (alive.current && epoch === checkEpoch.current) { setCheckFailed(true); setErrorOwner(owner); setError(String(cause instanceof Error ? cause.message : cause)); } }
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
        if (wasRunning.current && !next?.running) { void check(setupOwner(latestJob.current?.action)); callbacks.current.onComplete(); }
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
    const poll = async () => { const observed = jobEpoch.current; try { await status(); } catch (cause) { if (alive.current && observed === jobEpoch.current) { setReadWarning(true); setErrorOwner(latestJob.current ? setupOwner(latestJob.current.action) : remote ? "tailscale" : "node"); setError(String(cause instanceof Error ? cause.message : cause)); } } if (alive.current) timer = window.setTimeout(() => void poll(), 1500); };
    void poll(); return () => { alive.current = false; ++checkEpoch.current; ++jobEpoch.current; window.clearTimeout(timer); };
  }, []);
  const running = !!job?.running;
  useEffect(() => { callbacks.current.onBusy(running || submitting || uncertain || autoInstalling); }, [running, submitting, uncertain, autoInstalling]);
  async function action(name: string, targetId?: string, reinstall = false, targetVersion?: string, requireLatest = false) {
    if (pending.current || unconfirmed.current) return;
    let acceptedJob: Job | null | undefined;
    const request = ++submission.current;
    const owner = setupOwner(name === "acknowledge-interruption" ? job?.action : name);
    const attempt = { action: name, previousId: job?.id || job?.task?.id, startedAt: Date.now(), request };
    pending.current = true; ++jobEpoch.current; setSubmitting(true); setError(""); setReadWarning(false);
    const accept = (result: { job?: unknown }) => {
      if (!alive.current || request !== submission.current) return;
      ++jobEpoch.current;
      if (["node", "service", "tailscale"].includes(name) && (!validOperationJob(result?.job, "action") || (result?.job as Job).action !== name)) throw new DesktopResponsePendingError("安装响应不完整，结果尚未确认，正在核实。");
      if (result?.job) { const next = readJob(result.job); acceptedJob = next; latestJob.current = next; setJob(next); setStatusUnknown(false); wasRunning.current = !!next?.running; }
      unconfirmed.current = null; setUncertain(false); setError("");
      if (name === "reconcile-service") { void check("service"); callbacks.current.onComplete(); }
    };
    try {
      const result = await desktopInvoke<{ job?: unknown }>("axiom_setup", { action: name, confirmed: name === "acknowledge-interruption" || name === "service" && reinstall, ...(name === "reconcile-service" ? { maintenance: { id: targetId || job?.id } } : name === "service" && targetVersion ? { maintenance: { version: targetVersion, latest: requireLatest } } : {}) });
      accept(result);
    } catch (cause) {
      if (alive.current) {
        const message = String(cause instanceof Error ? cause.message : cause);
        setErrorOwner(owner); setError(message);
        if (isDesktopResponsePending(cause) && ["node", "service", "tailscale"].includes(name)) {
          unconfirmed.current = attempt; setUncertain(true);
          // Keep observing this exact invocation; never replay an installation.
          if (cause instanceof DesktopResponsePendingError && cause.response) {
            const rejectLate = (failure: unknown) => {
              if (!alive.current || unconfirmed.current !== attempt) return;
              const refused = isSubmissionRefused(failure);
              if (refused) { unconfirmed.current = null; setUncertain(false); }
              setReadWarning(!refused); setErrorOwner(owner);
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
  async function installService(reinstall = false, targetVersion?: string, requireLatest = false) {
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
      let runtime = await check("service");
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
        runtime = await check("service");
        if (!runtime) return;
        if (!runtime.nodeReady) throw Error("Node.js 安装后尚未就绪，请重新打开客户端再安装。");
      }
      if (alive.current) await action("service", undefined, reinstall, targetVersion, requireLatest);
    } catch (cause) { if (alive.current) { setReadWarning(false); setErrorOwner("service"); setError(cause instanceof Error ? cause.message : String(cause)); } }
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
    maintainService: (version, requireLatest) => { void installService(true, version, requireLatest); },
    showRuntime: () => { if (checkFailed || !environment) void check(); requestAnimationFrame(() => workflow.current?.focus()); },
  }));
  const recovering = job?.recovery?.state === "checking";
  const names = { node: "Node.js 与 npm", tailscale: "Tailscale", service: "后台服务" };
  const evidencePending = (name: string) => history.tasks.some(task => task.resource === name && ["running", "cancelling", "unknown", "interrupted"].includes(task.status));
  return <section ref={workflow} tabIndex={-1} className="setup-simple" aria-label={remote ? "远程连接准备" : "本地连接准备"}>
    {history.error && <p className="maintenance-warning" role="status">{history.error}<button className="maintenance-text-button" onClick={() => void history.refresh()}>重新读取维护证据</button></p>}
    {(["node", "tailscale", "service"] as const).filter(name => name === (remote ? "tailscale" : "node") || name === "service" && !remote || job?.action === name || evidencePending(name) || history.tasks.some(task => task.resource === name) || !!error && errorOwner === name).map(name => {
      const ownsJob = job?.action === name;
      const ownsStatus = ownsJob || !job && name === (remote ? "tailscale" : "node");
      const ownsFeedback = errorOwner === name;
      const serviceInstalled = !!service && ["running", "stopped"].includes(service.state);
      const known = name === "service" ? serviceInstalled || service?.state === "missing" : !!environment;
      const ready = name === "node" ? environment?.nodeReady : name === "tailscale" ? environment?.tailscale : serviceInstalled;
      return <ComponentCard key={name} className="update-component setup-component" kind={name === "service" ? "component" : "environment"} label={names[name]} regionLabel={`${names[name]}安装维护`}
        version={checking ? "正在检查…" : name === "node" ? environment?.nodeVersion || (environment ? "未安装" : "待检查") : !known ? "待检查" : ready ? "已安装" : "未安装"}
        status={name === "node" && environment?.nodeVersion && !ready ? "环境未就绪" : undefined}
        description={name === "node" ? "后台所需的 Node.js 与 npm" : name === "tailscale" ? "连接远程设备的私有网络" : "本机 Axiom 后台程序"}
        actions={<>
          <ComponentAction icon="scan-search" label="检查" disabled={checking || running || submitting || autoInstalling} onClick={() => void check(name)} />
          {ownsStatus && (running || interrupted || uncertain || statusUnknown || recovering || !job?.task && job?.phase === "error") && <ComponentAction icon="refresh-cw" label="重新读取安装进度" disabled={submitting} onClick={() => void status().catch(cause => { setErrorOwner(name); setError(String(cause)); })} />}
          {known && !ready && <ComponentAction icon="download" label="安装" primary disabled={disabled || checking || !environment} onClick={() => void (name === "service" ? installService() : action(name))} />}
          {name === "tailscale" && ready && <ComponentAction icon="external-link" label="打开" disabled={submitting} onClick={() => void action("launch-tailscale")} />}
          {name === "service" && ready && <ComponentAction icon="rotate-cw" label="重新安装服务" disabled={disabled || checking || !environment} onClick={() => setConfirmReinstall(true)} />}
        </>}
        details={<>
          {environment?.platform && <p className="maintenance-note">平台 · {environment.platform}</p>}
          {name === "node" && <p className="maintenance-note">需要 Node.js 22.19.0+ 与 npm。</p>}
          <details className="maintenance-details"><summary>下载与安装设置</summary><p className="maintenance-note">本机安装器共享的默认时限，不改变已开始的任务。</p><BudgetEditor value={budgets} onSave={budgets => control("defaults", { budgets })} /></details>
          <details className="startup-manual"><summary>手动安装</summary>
            <CommandLine label={`${names[name]}安装命令`} command={name === "service" ? command : windows ? name === "tailscale" ? "winget install --id Tailscale.Tailscale --exact" : "winget install --id OpenJS.NodeJS.LTS --exact" : name === "tailscale" ? "brew install --cask tailscale" : "brew install node"} />
            <ResourceLink label={`${names[name]}下载地址`} url={name === "service" ? "https://github.com/cosyeezz/axiom2/releases/latest" : name === "tailscale" ? "https://tailscale.com/download" : "https://nodejs.org/en/download"} onOpen={name === "service" ? undefined : () => void action(name === "tailscale" ? "open-tailscale" : "open-node")} />
            {name === "service" && children}
          </details>
        </>}>
        {name !== "tailscale" && environment && !environment.writable && <p className="connect-error" role="alert">安装目录不可写，请检查目录权限。</p>}
        <div id={ownsStatus ? "setup-recovery" : undefined} tabIndex={ownsStatus ? -1 : undefined}>
          {ownsJob && job?.task && <MaintenanceTaskView compact task={job.task} hasUnresolved={history.tasks.some(task => task.id !== job.task?.id && task.resource === name && (task.status === "unknown" || task.status === "interrupted"))} showError={!(ownsFeedback && error === job.task.error?.message)} connected={!statusUnknown && !uncertain} onCancel={() => control("cancel", { id: job.id })} onExtend={budgets => control("extend", { id: job.id, budgets })} />}
          {ownsStatus && (!job?.task && (running || job?.phase === "error" || interrupted) || uncertain || statusUnknown || recovering) && <div className={`setup-job ${job?.phase === "error" && !running && !interrupted ? "has-error" : ""}`} role="status">
            <div>{(running || recovering) && <Icon name="loader-circle" className="startup-spin" />}<span>{recovering ? "正在核实上次安装，完成后恢复安装入口…" : uncertain ? "正在核实安装结果，请勿重复安装。" : statusUnknown ? "安装记录暂未核实，请重试。" : job?.message}</span></div>
            {!job?.task && <InstallProgress value={job?.progress} running={running} phase={job?.phase} />}
            {job?.recovery?.message && <p className="connect-message">{job.recovery.message}</p>}
          </div>}
        </div>
        {ownsJob && interrupted && !running && (name === "service" ? <div className="startup-step-actions">{(windows || environment?.platform === "windows") && <button className="connect-primary" disabled={submitting || uncertain || recovering} onClick={() => void action("reconcile-service")}><Icon name={recovering ? "loader-circle" : "refresh-cw"} className={recovering ? "startup-spin" : ""} />{submitting || recovering ? "正在核实安装…" : "核实并恢复安装"}</button>}<p className="connect-footnote">核实退出后恢复安装入口，不会自动重装或停止后台。</p></div> : <button className="connect-secondary" disabled={submitting || uncertain} onClick={() => setConfirmRecovery(true)}>确认安装器退出后恢复</button>)}
        {ownsFeedback && error && <p className={readWarning || uncertain || checking || checkFailed || running ? "connect-message" : "connect-error"} role={readWarning || uncertain || checking || checkFailed || running ? "status" : "alert"}>{error}</p>}
        <DesktopUnresolvedTasks tasks={history.tasks} currentId={job?.task?.id} matches={task => task.resource === name} onRefresh={history.refresh} />
        {ownsJob && running && <p className="connect-footnote">{job?.foreground ? "安装在可见终端执行；可查看实际进度和错误，服务会在独立前台窗口运行。" : "安装在后台继续；请完成系统请求的授权。"}</p>}
        {name === "service" && confirmReinstall && <ConfirmDialog title="前台重新安装服务？" danger
          description="会先尝试正常关闭自管服务（正在执行的后台任务会中断），只清理确认属于 Axiom 的程序目录；清理失败则换新目录。项目、会话、模型设置与凭据保留。安装与服务均在可见终端执行。"
          confirmLabel="前台重新安装" confirmDisabled={disabled || !serviceInstalled} onClose={() => setConfirmReinstall(false)} onConfirm={async () => { if (!serviceInstalled) throw Error("服务安装状态尚未核实，请先检查。"); await installService(true); }} />}
        {ownsJob && confirmRecovery && interrupted && <ConfirmDialog title="确认安装器已退出？" danger
          description="请先确认本次系统安装器已经全部退出。仍在运行时解除占用可能导致重复安装。"
          confirmLabel="我已确认安装器全部退出" confirmDisabled={submitting || blocked || uncertain || !interrupted}
          onClose={() => setConfirmRecovery(false)} onConfirm={async () => { await action("acknowledge-interruption"); }} />}
      </ComponentCard>;
    })}
  </section>;
}
