import { useEffect, useRef, useState, type ReactNode } from "react";
import { DesktopTaskCenter } from "../maintenance/DesktopTaskCenter.js";
import { BudgetEditor, MaintenanceTaskView } from "../maintenance/MaintenanceView.js";
import { defaultMaintenanceBudgets, type MaintenanceTask, type MaintenanceBudgets } from "../../shared/maintenance.js";
import { desktopInvoke } from "./desktop-bridge.js";
import { Icon } from "../Icon.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import InstallProgress from "./InstallProgress.js";
import { CommandLine, IconButton, ResourceLink } from "./StartupControls.js";
type Environment = { nodeReady: boolean; nodeVersion: string; writable: boolean; tailscale: boolean; platform: string };
export type PreparationDetection = { environment: Environment | null; checking: boolean; failed: boolean; attention?: boolean };
type Job = { task?: MaintenanceTask; id?: string; action: string; running: boolean; phase: string; message: string; lines: string[]; progress?: unknown; startedAt?: number; logUpdatedAt?: number; exitCode?: number };
function readJob(value: unknown): Job | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || typeof (value as Job).running !== "boolean" || typeof (value as Job).phase !== "string") throw Error("安装记录不完整，请重新读取状态。");
  const job = value as Job;
  return { ...job, action: typeof job.action === "string" ? job.action : "", message: typeof job.message === "string" ? job.message : "正在核实安装状态", lines: Array.isArray(job.lines) ? job.lines.filter(line => typeof line === "string") : [] };
}
export default function SetupWizard({ remote, service, blocked, onBusy, onComplete, onDetection, children }: { remote: boolean; service: { state: string } | null; blocked: boolean; onBusy: (busy: boolean) => void; onComplete: () => void; onDetection: (detection: PreparationDetection) => void; children: ReactNode }) {
  const [budgets, setBudgets] = useState(defaultMaintenanceBudgets);
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [checking, setChecking] = useState(true);
  const [checkFailed, setCheckFailed] = useState(false);
  useEffect(() => { onDetection({ environment, checking, failed: checkFailed, attention: job?.phase === "interrupted" || job?.task?.status === "unknown" || job?.task?.status === "interrupted" }); }, [environment, checking, checkFailed, onDetection, job?.phase, job?.task?.status]);
  const [submitting, setSubmitting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const workflow = useRef<HTMLElement>(null);
  const [confirmRecovery, setConfirmRecovery] = useState(false);
  const windows = /Win/i.test(navigator.platform);
  const pending = useRef(false), alive = useRef(true), jobEpoch = useRef(0), checkEpoch = useRef(0);
  const wasRunning = useRef(false);
  const callbacks = useRef({ onBusy, onComplete }); callbacks.current = { onBusy, onComplete };
  const command = windows ? "irm https://raw.githubusercontent.com/cosyeezz/axiom2/master/install.ps1 | iex" : "curl -fsSL https://raw.githubusercontent.com/cosyeezz/axiom2/master/install.sh | sh";
  async function check() {
    const epoch = ++checkEpoch.current; setChecking(true); setCheckFailed(false); setError("");
    try {
      const next = await desktopInvoke<Environment>("axiom_setup", { action: "check" });
      if (!next || typeof next.nodeReady !== "boolean" || typeof next.writable !== "boolean" || typeof next.tailscale !== "boolean") throw Error("环境检测结果不完整，请重新验证。");
      if (alive.current && epoch === checkEpoch.current) setEnvironment(next);
    } catch (cause) { if (alive.current && epoch === checkEpoch.current) { setCheckFailed(true); setError(String(cause instanceof Error ? cause.message : cause)); } }
    finally { if (alive.current && epoch === checkEpoch.current) setChecking(false); }
  }
  async function status() {
    if (pending.current) return;
    const epoch = jobEpoch.current;
    const result = await desktopInvoke<{ job: unknown; budgets?: MaintenanceBudgets }>("axiom_setup", { action: "status" });
    if (!alive.current || epoch !== jobEpoch.current) return;
    if (!result || !("job" in result)) throw Error("安装状态未能读取，请重试。");
    const next = readJob(result.job); setJob(next);
    if (result.budgets) setBudgets(result.budgets);
    if (next) setUncertain(false);
    if (wasRunning.current && !next?.running) { void check(); callbacks.current.onComplete(); setChosen(null); }
    wasRunning.current = !!next?.running;
  }
  useEffect(() => {
    alive.current = true; void check(); let timer: number;
    const poll = async () => { try { await status(); } catch (cause) { if (alive.current) setError(String(cause instanceof Error ? cause.message : cause)); } if (alive.current) timer = window.setTimeout(() => void poll(), 1500); };
    void poll(); return () => { alive.current = false; ++checkEpoch.current; ++jobEpoch.current; window.clearTimeout(timer); };
  }, []);
  useEffect(() => { setChosen(null); }, [remote]);
  const running = !!job?.running;
  useEffect(() => { callbacks.current.onBusy(running || submitting || uncertain); }, [running, submitting, uncertain]);
  async function action(name: string) {
    if (pending.current) return;
    pending.current = true; ++jobEpoch.current; setSubmitting(true); setError("");
    try {
      const result = await desktopInvoke<{ job?: unknown }>("axiom_setup", { action: name, confirmed: name === "acknowledge-interruption" });
      if (alive.current && result?.job) { const next = readJob(result.job); setJob(next); wasRunning.current = !!next?.running; setUncertain(false); }
    } catch (cause) {
      if (alive.current) { const message = String(cause instanceof Error ? cause.message : cause); setError(message); if (/超时/.test(message) && ["node", "service", "tailscale"].includes(name)) setUncertain(true); }
    } finally { ++jobEpoch.current; pending.current = false; if (alive.current) setSubmitting(false); }
  }
  async function control(action: string, maintenance: Record<string, unknown>) {
    const result = await desktopInvoke<{ job?: unknown; budgets?: MaintenanceBudgets }>("axiom_setup", { action, maintenance });
    if (alive.current) { if (result.job) setJob(readJob(result.job)); if (result.budgets) setBudgets(result.budgets); }
  }
  const interrupted = job?.phase === "interrupted" || job?.task?.status === "unknown" || job?.task?.status === "interrupted";
  useEffect(() => {
    if (!interrupted) setConfirmRecovery(false);
  }, [interrupted]);
  const disabled = running || interrupted || uncertain || submitting || blocked;
  const installed = !!service && ["running", "stopped", "starting", "stopping"].includes(service.state);
  const steps = remote ? [{ id: "network", title: "连接环境", detail: "Tailscale", done: !!environment?.tailscale }, { id: "connect", title: "连接工作台", detail: "验证目标服务", done: false }] : [{ id: "runtime", title: "运行环境", detail: "Node.js · npm", done: !!environment?.nodeReady && !!environment.writable }, { id: "service", title: "后台服务", detail: "安装与校验", done: installed }, { id: "connect", title: "连接工作台", detail: "启动与验证", done: service?.state === "running" }];
  const suggested = steps.find(step => !step.done)?.id || "connect";
  const selected = steps.find(step => step.id === chosen) || steps.find(step => step.id === suggested)!;
  const checkingStep = selected.id === "runtime" || selected.id === "network";
  return <section ref={workflow} tabIndex={-1} className="startup-workflow" aria-label={remote ? "远程连接准备" : "本地连接准备"}>
    <nav className="startup-steps" aria-label="准备步骤">{steps.map((step, index) => <button key={step.id} type="button" disabled={running || submitting || blocked || uncertain} aria-current={selected.id === step.id ? "step" : undefined} data-done={step.done} onClick={() => setChosen(step.id)}><span className="startup-step-marker">{step.done ? <Icon name="circle-check" /> : <span>{String(index + 1).padStart(2, "0")}</span>}</span><span><strong>{step.title}</strong><small>{step.detail}</small></span>{selected.id === step.id && <Icon name="chevron-right" className="startup-step-pointer" />}</button>)}<p>仅在需要安装时准备；已有服务可在上方直接连接。</p></nav>
    <div className="startup-step-content" key={`${remote}-${selected.id}`}>
      {checkingStep ? <><div className="startup-content-heading"><div><span className="startup-overline">{remote ? "01 / NETWORK" : "01 / RUNTIME"}</span><h2>{selected.done ? "环境已就绪" : remote ? "准备连接环境" : "准备运行环境"}</h2></div><IconButton label="重新验证环境" icon="refresh-cw" spinning={checking} disabled={checking || running || submitting} onClick={() => void check()} /></div>
        <p className="startup-description">{remote ? "登录同一 Tailscale 网络，即可连接你的其他电脑。" : "检查 Node.js、npm 和目录权限，在这里完成安装与验证。"}</p>
        <div className="startup-check-result" role="status"><Icon name={checking ? "loader-circle" : selected.done ? "circle-check" : environment ? "circle-help" : "triangle-alert"} className={checking ? "startup-spin" : ""} /><div><strong>{checking ? "正在验证环境…" : remote ? environment?.tailscale ? "已安装 Tailscale" : "尚未检测到 Tailscale" : environment?.nodeReady ? `${environment.nodeVersion || "Node.js"} · npm 已就绪` : "需要 Node.js 22.19.0+ 与 npm"}</strong><span>{remote ? "安装后打开 Tailscale 完成登录，再刷新设备列表。" : environment ? environment.writable ? "安装目录可写" : "安装目录不可写，请检查目录权限" : "检查结果会显示在这里"}</span></div></div>
        <CommandLine label={remote ? "Tailscale 安装命令" : "Node.js 安装命令"} command={windows ? remote ? "winget install --id Tailscale.Tailscale --exact" : "winget install --id OpenJS.NodeJS.LTS --exact" : remote ? "brew install --cask tailscale" : "brew install node"} />
        <p className="connect-footnote">{windows ? "在 PowerShell 中执行；没有 winget 可使用下方自动安装或官方下载。" : "命令需已安装 Homebrew；也可使用下方自动安装或官方下载。"}{!remote && "安装后重新打开终端，点击右上角验证。"}</p>
        <ResourceLink label={remote ? "Tailscale 下载地址" : "Node.js 下载地址"} url={remote ? "https://tailscale.com/download" : "https://nodejs.org/en/download"} onOpen={() => void action(remote ? "open-tailscale" : "open-node")} />
        <div className="startup-step-actions">{!(remote ? environment?.tailscale : environment?.nodeReady) && <button className="connect-primary" disabled={disabled || checking || !environment} onClick={() => void action(remote ? "tailscale" : "node")}><Icon name="download" />{remote ? "安装 Tailscale" : "安装 Node.js"}</button>}{remote && environment?.tailscale && <IconButton label="打开 Tailscale" icon="external-link" disabled={submitting} onClick={() => void action("launch-tailscale")} />}{selected.done && <button className="connect-primary" disabled={disabled} onClick={() => setChosen(remote ? "connect" : installed ? "connect" : "service")}>下一步<Icon name="arrow-right" /></button>}</div>
      </> : selected.id === "service" ? <><div className="startup-content-heading"><div><span className="startup-overline">02 / SERVICE</span><h2>{installed ? "后台已安装" : "安装后台服务"}</h2></div><IconButton label="重新验证服务" icon="refresh-cw" disabled={disabled} onClick={onComplete} /></div><p className="startup-description">选择一行命令、自动安装或手动下载。安装前需有 Node.js 22.19.0+ 与 npm；已有服务可直接在上方连接。</p><CommandLine label="一行安装命令" command={command} /><p className="connect-footnote">在{windows ? " PowerShell " : "终端"}中执行，安装正式服务并启动；不会自动打开工作台。</p><ResourceLink label="服务下载地址" url="https://github.com/cosyeezz/axiom2/releases/latest" />
        <div className="startup-step-actions"><button className="connect-primary" disabled={disabled || checking || !environment?.nodeReady || !environment.writable || !service || (!installed && service.state !== "missing")} onClick={() => installed ? setChosen("connect") : void action("service")}><Icon name={installed ? "arrow-right" : "download"} />{installed ? "下一步" : "安装并启动服务"}</button></div>
        <details className="startup-manual"><summary>手动安装与开发运行<Icon name="chevron-down" /></summary><p>已有服务请先关闭；手动安装同样使用正式 Release 包。完成后在上方点击连接。</p><CommandLine label="手动安装命令" command="npm install --global https://github.com/cosyeezz/axiom2/releases/latest/download/axiom2.tgz" /><CommandLine label="启动服务命令" command="axiom2 start" /><p>已有源码和开发依赖：在仓库 app 目录运行以下命令，并连接开发服务使用的端口。</p><CommandLine label="开发运行命令" command="npm run dev" /></details>
      </> : children}
      <button className="maintenance-text-button" onClick={() => setHistoryOpen(true)}><Icon name="history" />安装任务记录</button>
      {job?.task && <MaintenanceTaskView task={job.task} showError={!historyOpen} onCancel={() => control("cancel", { id: job.id })} onExtend={budgets => control("extend", { id: job.id, budgets })} />}
      <details className="maintenance-details"><summary>首次安装下载设置</summary><BudgetEditor value={budgets} onSave={budgets => control("defaults", { budgets })} /><p className="maintenance-note">系统安装器管理自己的下载与安装过程，无法提供实时字节或安全取消时，仅显示阶段和用时。</p></details>
      {(running || job?.phase === "error" || interrupted || uncertain) && <div id="setup-recovery" tabIndex={-1} className={`setup-job ${job?.phase === "error" || interrupted ? "has-error" : ""}`} role="status"><div>{running && <Icon name="loader-circle" className="startup-spin" />}<span>{uncertain ? "操作结果尚未确认，请先重新读取进度，避免重复安装。" : job?.message}</span><IconButton label="重新读取安装进度" icon="refresh-cw" onClick={() => void status().catch(cause => setError(String(cause)))} /></div>{!job?.task && <InstallProgress value={job?.progress} running={running} />}{running && !job?.task && job?.startedAt && <p className="connect-footnote">已用 {Math.max(0, Math.floor((Date.now() - job.startedAt) / 1000))} 秒{job.logUpdatedAt ? ` · 最近输出于 ${Math.max(0, Math.floor((Date.now() - job.logUpdatedAt) / 1000))} 秒前` : " · 等待执行器输出"}{!job.progress && "；此阶段无可计算的总进度。"}</p>}{!!job?.lines.length && <details open={running || job.phase === "error"}><summary>执行详情{typeof job.exitCode === "number" ? ` · 退出码 ${job.exitCode}` : ""}</summary><pre>{job.lines.join("\n").replaceAll("@@phase:", "")}</pre></details>}</div>}
      {interrupted && !running && (job?.action === "service" ? <button className="connect-secondary" disabled={submitting || blocked} onClick={() => { onComplete(); void status().catch(cause => setError(String(cause))); }}>重新核实后台状态</button> : <button className="connect-secondary" disabled={submitting || blocked} onClick={() => setConfirmRecovery(true)}>确认安装器退出后解除占用</button>)}
      {error && !historyOpen && <p className="connect-error" role="alert">{error}</p>}
      {running && <p className="connect-footnote">请保持客户端打开，并完成系统请求的安装授权。</p>}
    </div>
    {historyOpen && <DesktopTaskCenter kind="setup" current={job?.task} onClose={() => setHistoryOpen(false)} onSource={() => { setHistoryOpen(false); window.requestAnimationFrame(() => workflow.current?.focus()); }} onChanged={() => { void status().catch(cause => setError(String(cause))); }} />}
    {confirmRecovery && interrupted && <ConfirmDialog title="确认安装器已退出？" danger
      description="请先确认本次系统安装器已经全部退出。仍在运行时解除占用可能导致重复安装。"
      confirmLabel="我已确认安装器全部退出" confirmDisabled={submitting || blocked || uncertain || !interrupted}
      onClose={() => setConfirmRecovery(false)} onConfirm={() => { setConfirmRecovery(false); void action("acknowledge-interruption"); }} />}
  </section>;
}
