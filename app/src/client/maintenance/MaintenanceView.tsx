import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "../Icon.js";
import { defaultMaintenanceBudgets, maintenanceActive, maintenanceBudgetLabels, maintenancePhaseLabels, maintenanceStatusLabels, validMaintenanceBudgets, type MaintenanceBudgets, type MaintenanceTask } from "../../shared/maintenance.js";
import "../styles/maintenance.css";

const bytes = (n: number) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1024 ** 2).toFixed(1)} MiB`;
const duration = (ms: number) => ms < 60_000 ? `${Math.floor(ms / 1000)} 秒` : `${Math.floor(ms / 60000)} 分 ${Math.floor(ms / 1000) % 60} 秒`;
export const endpointLabels = { backend: "所连接后台", browser: "当前浏览器", desktop: "本机桌面" };
export const endpointIcons = { backend: "server", browser: "globe", desktop: "monitor" };
const phaseIcons = { queued: "clock", checking: "search", downloading: "download", verifying: "circle-check", installing: "package", validating: "circle-check", removing: "trash-2" };
export function taskStatusLabel(task: MaintenanceTask) { return maintenanceActive(task) && task.phase === "queued" ? "等待执行条件" : maintenanceStatusLabels[task.status]; }
export function TaskStatusIcon({ task }: { task: MaintenanceTask }) {
  const name = task.status === "succeeded" ? "circle-check" : task.status === "failed" ? "circle-alert" : task.status === "cancelled" ? "circle-x" : task.status === "interrupted" || task.status === "unknown" ? "circle-help" : phaseIcons[task.phase];
  return <Icon name={name} />;
}
const budgetTemplates: { id: string; label: string; value: MaintenanceBudgets }[] = [
  { id: "standard", label: "标准", value: defaultMaintenanceBudgets },
  { id: "slow", label: "网络较慢", value: { headersMs: 60000, idleMs: 180000, installMs: 1200000, totalMs: 3600000 } },
  { id: "large", label: "大文件安装", value: { headersMs: 30000, idleMs: 90000, installMs: 3600000, totalMs: 7200000 } },
];
const errorLabels: Record<NonNullable<MaintenanceTask["error"]>["code"], string> = {
  cancelled: "已取消", "headers-timeout": "等待响应超时", "idle-timeout": "下载停滞", "install-timeout": "安装超时", "total-timeout": "总时限已到",
  network: "网络连接失败", http: "下载源返回错误", "output-limit": "返回数据超限", "stop-unconfirmed": "退出未确认", operation: "操作未完成",
};
export function BudgetEditor({ value, onSave, disabled, running = false }: { value: MaintenanceBudgets; onSave: (value: MaintenanceBudgets) => Promise<unknown>; disabled?: boolean; running?: boolean }) {
  const [draft, setDraft] = useState(value), [saving, setSaving] = useState(false), [error, setError] = useState("");
  useEffect(() => setDraft(value), [value.headersMs, value.idleMs, value.installMs, value.totalMs]);
  const save = async () => {
    if (!validMaintenanceBudgets(draft)) { setError("每项须为 1 秒至 24 小时。"); return; }
    if (running && (Object.keys(value) as (keyof MaintenanceBudgets)[]).some(key => draft[key] < value[key])) { setError("运行中只能延长时限，请保留或增加当前数值。"); return; }
    setSaving(true); setError("");
    try { await onSave(draft); } catch (error) { setError(error instanceof Error ? error.message : "设置未能保存。"); } finally { setSaving(false); }
  };
  const template = budgetTemplates.find(item => (Object.keys(draft) as (keyof MaintenanceBudgets)[]).every(key => item.value[key] === draft[key]))?.id ?? "custom";
  return <div className="maintenance-budget">
    <label className="maintenance-budget-template"><span>时限模板</span><select className="input" value={template} disabled={disabled || saving} onChange={event => {
      const chosen = budgetTemplates.find(item => item.id === event.target.value);
      if (!chosen) return;
      const next = { ...chosen.value };
      if (running) for (const key of Object.keys(next) as (keyof MaintenanceBudgets)[]) next[key] = Math.max(value[key], next[key]);
      setDraft(next); setError("");
    }}><option value="custom" disabled>自定义</option>{budgetTemplates.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <div className="maintenance-budget-fields">{(Object.keys(maintenanceBudgetLabels) as (keyof MaintenanceBudgets)[]).map(key => <label key={key}><span>{maintenanceBudgetLabels[key]}</span><span className="maintenance-budget-input"><input className="input" type="number" min={running ? Math.ceil(value[key] / 1000) : 1} max={86400} step={1} disabled={disabled || saving} value={draft[key] / 1000} onChange={event => setDraft({ ...draft, [key]: Number(event.target.value) * 1000 })} /><span aria-hidden="true">秒</span></span></label>)}</div>
    <p className="maintenance-note">{running ? "仅延长本次时限，不会重新启动任务。" : "用于此执行端的新任务，当前任务不受影响。"}</p>
    <button className="btn maintenance-save" disabled={disabled || saving} onClick={() => void save()}><Icon name={saving ? "loader-circle" : "check"} />{saving ? "保存中…" : running ? "延长本次时限" : "保存设置"}</button>
    {error && <p className="maintenance-error" role="alert"><Icon name="circle-alert" /><span>{error}</span></p>}
  </div>;
}
export function MaintenanceTaskView({ task, connected = true, onCancel, onExtend, onReconcile, compact = false, showError = true }: { task: MaintenanceTask; connected?: boolean; onCancel?: () => Promise<unknown>; onExtend?: (budgets: MaintenanceBudgets) => Promise<unknown>; onReconcile?: () => Promise<unknown>; compact?: boolean; showError?: boolean }) {
  const [now, setNow] = useState(Date.now()), [error, setError] = useState(""), [sending, setSending] = useState(false);
  const active = maintenanceActive(task), waiting = active && task.phase === "queued";
  useEffect(() => { if (!active) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [active]);
  useEffect(() => { setError(""); }, [task.id]);
  const transfer = task.transfer, fresh = !!transfer && now - transfer.updatedAt < 2000;
  const rate = active && connected && fresh && transfer?.connection === "receiving" ? transfer.bytesPerSecond : undefined;
  const percent = transfer?.total ? Math.min(100, transfer.received / transfer.total * 100) : undefined;
  const elapsed = Math.max(0, (task.finishedAt ?? now) - (task.startedAt ?? task.createdAt));
  const cancel = async () => { setSending(true); setError(""); try { await onCancel?.(); } catch (error) { setError(error instanceof Error ? error.message : "取消请求未确认，请核实任务。"); } finally { setSending(false); } };
  const reconcile = async () => { if (sending) return; setSending(true); setError(""); try { await onReconcile?.(); } catch (cause) { setError(cause instanceof Error ? cause.message : "原任务退出尚未确认，记录仍保留。"); } finally { setSending(false); } };
  const title = task.status === "unknown" || task.status === "interrupted" ? "任务结果待核实" : waiting ? "等待执行条件" : active ? `${maintenancePhaseLabels[task.phase]}中` : task.status === "succeeded" ? "任务完成" : `${maintenancePhaseLabels[task.phase]}${task.status === "cancelled" ? "已取消" : "未完成"}`;
  return <div className="maintenance-task" data-status={task.status} data-compact={compact || undefined}>
    <div className="maintenance-task-heading">
      <span className="maintenance-state-icon"><TaskStatusIcon task={task} /></span>
      <div className="maintenance-task-copy"><strong>{title}</strong><span className="maintenance-task-meta"><Icon name={endpointIcons[task.endpoint]} />{endpointLabels[task.endpoint]}<span className="maintenance-meta-separator">·</span>{waiting ? "已等待" : "用时"} {duration(elapsed)}</span></div>
      {!waiting && <span className="maintenance-status" role="status">{taskStatusLabel(task)}</span>}
      {waiting && <span className="maintenance-status" role="status">等待中</span>}
      {active && task.capabilities.cancel && onCancel && <button className="maintenance-icon-button" aria-label={task.status === "cancelling" ? "正在取消任务" : "取消任务"} title="取消任务" disabled={!connected || sending || task.status === "cancelling"} onClick={() => void cancel()}><Icon name={task.status === "cancelling" ? "loader-circle" : "x"} /></button>}
    </div>
    {!connected && <p className="maintenance-warning" role="status"><Icon name="circle-help" /><span>连接中断，重连后核实原任务。</span></p>}
    {active && !waiting && !compact && task.steps.length > 1 && <ol className="maintenance-steps" aria-label={`总体进度：已完成 ${task.completedSteps}/${task.steps.length} 步`}>{task.steps.map((phase, index) => <li key={phase} data-complete={index < task.completedSteps} aria-current={phase === task.phase ? "step" : undefined}><span className="maintenance-step-mark" aria-hidden="true">{index < task.completedSteps ? <Icon name="check" /> : <span />}</span>{maintenancePhaseLabels[phase]}</li>)}</ol>}
    {transfer && active && <div className="maintenance-transfer">
      <div className="maintenance-meter-label"><span title={transfer.source}>{transfer.source ?? "下载源"}</span><strong>{percent === undefined ? "接收中" : `${percent.toFixed(1)}%`}</strong></div>
      <progress aria-label="当前下载进度" max={100} value={percent} />
      <dl className="maintenance-metrics"><div><dt>已下载</dt><dd>{bytes(transfer.received)}{transfer.total && <small> / {bytes(transfer.total)}</small>}</dd></div><div><dt>传输速度</dt><dd>{rate ? `${bytes(rate)}/s` : transfer.connection === "finished" ? "下载结束" : !connected ? "待核实" : transfer.connection === "retrying" ? `等待重试（${transfer.attempt}/2）` : transfer.connection === "connecting" ? "正在连接" : !fresh ? "等待数据" : "正在测量"}</dd></div><div><dt>下载剩余</dt><dd>{rate && transfer.total ? `约 ${duration(Math.max(0, transfer.total - transfer.received) / rate * 1000)}` : "—"}</dd></div></dl>
    </div>}
    {task.message && (task.status !== "failed" || !task.error || !showError) && <p className="maintenance-message">{task.message}</p>}
    {waiting && !task.message && <p className="maintenance-message">正在核实资源占用，满足条件后开始。</p>}
    {showError && task.status === "failed" && task.error && <p className="maintenance-error" role="alert"><Icon name="circle-alert" /><span><span className="maintenance-error-kind">{errorLabels[task.error.code]} · {maintenancePhaseLabels[task.error.phase]}</span>{task.error.message}</span></p>}
    {(task.status === "interrupted" || task.status === "unknown") && <p className="maintenance-warning"><Icon name="circle-help" /><span>先到来源页面核实结果，再决定是否重试。</span></p>}
    {task.status === "unknown" && onReconcile && <button className="maintenance-text-button" disabled={!connected || sending} onClick={() => void reconcile()}><Icon name={sending ? "loader-circle" : "refresh-cw"} />{sending ? "正在核实…" : "核实中断任务"}</button>}
    {showError && error && <p className="maintenance-warning" role="status"><Icon name="circle-help" /><span>{error}</span></p>}
    {!compact && <details className="maintenance-details maintenance-task-details"><summary><Icon name="sliders-horizontal" /><span>{active ? "时限与任务详情" : "查看任务详情"}</span><Icon name="chevron-down" /></summary><div className="maintenance-details-body">
      {active && task.capabilities.extend && onExtend ? <BudgetEditor value={task.budgets} running disabled={!connected} onSave={onExtend} /> : <dl className="maintenance-metrics">{(Object.keys(maintenanceBudgetLabels) as (keyof MaintenanceBudgets)[]).map(key => <div key={key}><dt>{maintenanceBudgetLabels[key]}</dt><dd>{duration(task.budgets[key])}</dd></div>)}</dl>}
      <dl className="maintenance-record">{transfer && <><div><dt>下载来源</dt><dd>{transfer.source ?? "未提供"}</dd></div><div><dt>网络路线</dt><dd>{task.endpoint === "browser" ? "由浏览器管理，具体路线未提供" : "执行端未提供"}</dd></div></>}<div><dt>作用范围</dt><dd>{task.scope}</dd></div><div><dt>最后更新</dt><dd>{new Date(task.updatedAt).toLocaleString()}</dd></div><div><dt>任务编号</dt><dd>{task.id}</dd></div><div><dt>尝试编号</dt><dd>{task.attemptId}</dd></div>{!active && transfer && <div><dt>接收数据</dt><dd>{bytes(transfer.received)}</dd></div>}</dl>
    </div></details>}
  </div>;
}
export function MaintenancePanel({ label, location, children, task, connected, onCancel, onExtend, onOpenTasks, showError = true }: { label: string; location: string; children?: ReactNode; task?: MaintenanceTask; connected?: boolean; onCancel?: () => Promise<unknown>; onExtend?: (budgets: MaintenanceBudgets) => Promise<unknown>; onOpenTasks?: () => void; showError?: boolean }) {
  return <section className="section tools-section maintenance-panel" aria-label={`${label}维护`}><div className="maintenance-panel-heading"><div className="maintenance-panel-title"><span className="maintenance-resource-icon"><Icon name="package" /></span><div><h3>{label}</h3><p className="maintenance-note">{location}</p></div></div>{onOpenTasks && <button className="maintenance-text-button" onClick={onOpenTasks}><Icon name="history" /><span>任务记录</span><Icon name="chevron-right" /></button>}</div><div className="maintenance-resource-content">{children}</div>{task && <MaintenanceTaskView task={task} showError={showError} connected={connected} onCancel={onCancel} onExtend={onExtend} />}</section>;
}
