import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../Icon.js";
import { Select } from "../Select.js";
import { defaultMaintenanceBudgets, maintenanceActive, maintenanceBudgetLabels, maintenancePhaseLabels, maintenanceStatusLabels, validMaintenanceBudgets, type MaintenanceBudgets, type MaintenanceTask } from "../../shared/maintenance.js";
import "../styles/maintenance.css";

const bytes = (n: number) => n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KiB` : `${(n / 1024 ** 2).toFixed(1)} MiB`;
const duration = (ms: number) => ms < 60_000 ? `${Math.floor(ms / 1000)} 秒` : `${Math.floor(ms / 60000)} 分 ${Math.floor(ms / 1000) % 60} 秒`;
export const endpointLabels = { backend: "所连接后台", browser: "当前浏览器", desktop: "本机桌面" };
export const endpointIcons = { backend: "server", browser: "globe", desktop: "monitor" };
const phaseIcons = { queued: "clock", checking: "search", downloading: "download", verifying: "circle-check", installing: "package", validating: "circle-check", removing: "trash-2" };
export function taskStatusLabel(task: MaintenanceTask) { return task.status === "cancelling" ? "正在取消" : maintenanceActive(task) && task.phase === "queued" ? "等待执行条件" : maintenanceStatusLabels[task.status]; }
export function TaskStatusIcon({ task }: { task: MaintenanceTask }) {
  const name = task.status === "succeeded" ? "circle-check" : task.status === "failed" ? "circle-alert" : task.status === "cancelled" ? "circle-x" : task.status === "interrupted" || task.status === "unknown" ? "circle-help" : phaseIcons[task.phase];
  return <Icon name={name} />;
}
const budgetTemplates: { id: string; label: string; value: MaintenanceBudgets }[] = [
  { id: "standard", label: "标准", value: defaultMaintenanceBudgets },
  { id: "slow", label: "网络较慢", value: { headersMs: 60000, idleMs: 180000, installMs: 1200000, totalMs: 3600000 } },
  { id: "large", label: "大文件安装", value: { headersMs: 30000, idleMs: 90000, installMs: 3600000, totalMs: 7200000 } },
];
export function BudgetEditor({ value, onSave, disabled, running = false }: { value: MaintenanceBudgets; onSave: (value: MaintenanceBudgets) => Promise<unknown>; disabled?: boolean; running?: boolean }) {
  const [draft, setDraft] = useState(value), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const templateId = useId();
  useEffect(() => setDraft(value), [value.headersMs, value.idleMs, value.installMs, value.totalMs]);
  const save = async () => {
    if (!validMaintenanceBudgets(draft)) { setError("每项须为 1 秒至 24 小时。"); return; }
    if (running && (Object.keys(value) as (keyof MaintenanceBudgets)[]).some(key => draft[key] < value[key])) { setError("运行中只能延长时限，请保留或增加当前数值。"); return; }
    setSaving(true); setError("");
    try { await onSave(draft); } catch (error) { setError(error instanceof Error ? error.message : "设置未能保存。"); } finally { setSaving(false); }
  };
  const template = budgetTemplates.find(item => (Object.keys(draft) as (keyof MaintenanceBudgets)[]).every(key => item.value[key] === draft[key]))?.id ?? "custom";
  return <div className="maintenance-budget">
    <div className="maintenance-budget-template"><label htmlFor={templateId}>时限模板</label><Select id={templateId} label="时限模板" value={template}
      options={[...(template === "custom" ? [{ value: "custom", label: "自定义" }] : []), ...budgetTemplates.map(item => ({ value: item.id, label: item.label }))]}
      disabled={disabled || saving} onChange={id => {
      const chosen = budgetTemplates.find(item => item.id === id);
      if (!chosen) return;
      const next = { ...chosen.value };
      if (running) for (const key of Object.keys(next) as (keyof MaintenanceBudgets)[]) next[key] = Math.max(value[key], next[key]);
      setDraft(next); setError("");
    }} /></div>
    <div className="maintenance-budget-fields">{(Object.keys(maintenanceBudgetLabels) as (keyof MaintenanceBudgets)[]).map(key => <label key={key}><span>{maintenanceBudgetLabels[key]}</span><span className="maintenance-budget-input"><input className="input" type="number" min={running ? Math.ceil(value[key] / 1000) : 1} max={86400} step={1} disabled={disabled || saving} value={draft[key] / 1000} onChange={event => setDraft({ ...draft, [key]: Number(event.target.value) * 1000 })} /><span aria-hidden="true">秒</span></span></label>)}</div>
    <p className="maintenance-note">{running ? "仅延长本次时限，不会重新启动任务。" : "用于此执行端的新任务，当前任务不受影响。"}</p>
    <button className="btn maintenance-save" disabled={disabled || saving} onClick={() => void save()}><Icon name={saving ? "loader-circle" : "check"} />{saving ? "保存中…" : running ? "延长本次时限" : "保存设置"}</button>
    {error && <p className="maintenance-error" role="alert"><Icon name="circle-alert" /><span>{error}</span></p>}
  </div>;
}
function operationLabel(action: string) {
  const name = action.split(/[.:]/).at(-1)?.toLowerCase() ?? action;
  return /check|refresh/.test(name) ? "检查" : /uninstall|remove/.test(name) ? "卸载" : /reinstall/.test(name) ? "重新安装" : /install/.test(name) ? "安装" : /update/.test(name) ? "更新" : /recover|restore/.test(name) ? "恢复" : "操作";
}

export function MaintenanceTaskView({ task, connected = true, onCancel, onExtend, onReconcile, compact = false, showError = true }: { task: MaintenanceTask; connected?: boolean; onCancel?: () => Promise<unknown>; onExtend?: (budgets: MaintenanceBudgets) => Promise<unknown>; onReconcile?: () => Promise<unknown>; compact?: boolean; showError?: boolean; hasUnresolved?: boolean }) {
  const [now, setNow] = useState(Date.now()), [error, setError] = useState(""), [sending, setSending] = useState(false);
  const active = maintenanceActive(task), waiting = active && task.phase === "queued";
  const pending = useRef(false);
  useEffect(() => { if (!active) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [active]);
  useEffect(() => { setError(""); }, [task.id]);
  const transfer = task.transfer, fresh = !!transfer && now - transfer.updatedAt < 2000;
  const rate = active && connected && fresh && transfer?.connection === "receiving" ? transfer.bytesPerSecond : undefined;
  const percent = transfer?.total ? Math.min(100, transfer.received / transfer.total * 100) : undefined;
  const elapsed = Math.max(0, (task.finishedAt ?? now) - (task.startedAt ?? task.createdAt));
  const control = async (callback: (() => Promise<unknown>) | undefined, fallback: string) => {
    if (pending.current || !connected || !callback) return;
    pending.current = true; setSending(true); setError("");
    try { await callback(); } catch (cause) { setError(cause instanceof Error ? cause.message : fallback); }
    finally { pending.current = false; setSending(false); }
  };
  const cancel = () => control(onCancel, "取消请求未确认，请核实任务。");
  const reconcile = () => control(onReconcile, "原任务退出尚未确认，记录仍保留。");
  if (!active) {
    const uncertain = task.status === "unknown" || task.status === "interrupted";
    const settled = task.status === "succeeded" || task.status === "cancelled";
    // Settled work leaves no progress/result panel. Durable evidence stays in the executor.
    if (settled) return null;
    const title = uncertain ? `${operationLabel(task.action)}${task.status === "interrupted" ? "已中断，结果待核实" : "结果待核实"}` : `${operationLabel(task.action)}${taskStatusLabel(task)}`;
    return <div className={`maintenance-task maintenance-notice${settled ? " maintenance-result" : ""}`} data-status={task.status} data-task-id={task.id}>
      <div className="maintenance-notice-heading"><TaskStatusIcon task={task} /><span role="status">{title}</span>{uncertain && onReconcile && <button className="maintenance-text-button" disabled={!connected || sending} onClick={() => void reconcile()}><Icon name={sending ? "loader-circle" : "refresh-cw"} />{sending ? "正在核实…" : "核实中断任务"}</button>}</div>
      {uncertain && <p className="maintenance-notice-message">{task.message || task.error?.message || "请检查当前安装及原进程退出情况。"} 原操作不会自动重试。</p>}
      {uncertain && <p className="maintenance-notice-meta">{endpointLabels[task.endpoint]} · {task.scope} · {new Date(task.updatedAt).toLocaleString()}</p>}
      {!uncertain && task.message && task.status !== "failed" && <p className="maintenance-notice-message">{task.message}</p>}
      {showError && task.status === "failed" && task.error && <p className="maintenance-error" role="alert"><Icon name="circle-alert" /><span>{task.error.message}</span></p>}
      {showError && task.status === "failed" && !task.error && task.message && <p className="maintenance-error" role="alert">{task.message}</p>}
      {!connected && uncertain && <p className="maintenance-warning" role="status">连接中断，重连后核实原任务。</p>}
      {error && <p className="maintenance-warning" role="status">{error}</p>}
    </div>;
  }
  const title = task.status === "cancelling" ? `正在取消${waiting ? "" : ` · ${maintenancePhaseLabels[task.phase]}阶段`}` : waiting ? "等待执行条件" : `${maintenancePhaseLabels[task.phase]}中`;
  const transferState = !connected ? "待核实" : transfer?.connection === "finished" ? "下载结束" : transfer?.connection === "connecting" ? "正在连接" : transfer?.connection === "retrying" ? "等待重试" : transfer?.connection === "waiting" || !fresh ? "等待数据" : "接收中";
  return <div className="maintenance-task" data-status={task.status} data-compact={compact || undefined}>
    <div className="maintenance-task-heading">
      <span className="maintenance-state-icon"><TaskStatusIcon task={task} /></span>
      <div className="maintenance-task-copy"><strong>{title}</strong><span className="maintenance-task-meta">{waiting ? "已等待" : "用时"} {duration(elapsed)}</span></div>
      <span className="maintenance-status" role="status">{taskStatusLabel(task)}</span>
      {active && task.capabilities.cancel && onCancel && <button className="maintenance-icon-button" aria-label={task.status === "cancelling" ? "正在取消任务" : "取消任务"} title="取消任务" disabled={!connected || sending || task.status === "cancelling"} onClick={() => void cancel()}><Icon name={task.status === "cancelling" ? "loader-circle" : "x"} /></button>}
    </div>
    {!connected && <p className="maintenance-warning" role="status"><Icon name="circle-help" /><span>连接中断，重连后核实原任务。</span></p>}
    {active && !waiting && task.steps.length > 1 && <ol className="maintenance-steps" aria-label={`总体进度：已完成 ${task.completedSteps}/${task.steps.length} 步`}>{task.steps.map((phase, index) => <li key={phase} data-complete={index < task.completedSteps} aria-current={phase === task.phase ? "step" : undefined}><span className="maintenance-step-mark" aria-hidden="true">{index < task.completedSteps ? <Icon name="check" /> : <span />}</span>{maintenancePhaseLabels[phase]}</li>)}</ol>}
    {transfer && active && task.phase === "downloading" && <div className="maintenance-transfer">
      <div className="maintenance-meter-label"><span title={transfer.source}>{transfer.source ?? "下载源"}</span><strong>{percent === undefined ? transferState : `${percent.toFixed(1)}%`}</strong></div>
      <progress aria-label="当前下载进度" max={100} value={percent} />
      <dl className="maintenance-metrics"><div><dt>已下载</dt><dd>{bytes(transfer.received)}{transfer.total && <small> / {bytes(transfer.total)}</small>}</dd></div><div><dt>传输速度</dt><dd>{rate ? `${bytes(rate)}/s` : transfer.connection === "finished" ? "下载结束" : !connected ? "待核实" : transfer.connection === "retrying" ? `等待重试（${transfer.attempt}/2）` : transfer.connection === "connecting" ? "正在连接" : !fresh ? "等待数据" : "正在测量"}</dd></div><div><dt>下载剩余</dt><dd>{rate && transfer.total ? `约 ${duration(Math.max(0, transfer.total - transfer.received) / rate * 1000)}` : "—"}</dd></div></dl>
    </div>}
    {task.message && <p className="maintenance-message">{task.message}</p>}
    {waiting && !task.message && <p className="maintenance-message">正在核实资源占用，满足条件后开始。</p>}
    {error && <p className="maintenance-warning" role="status"><Icon name="circle-help" /><span>{error}</span></p>}
    {<details className="maintenance-details maintenance-task-details"><summary><Icon name="sliders-horizontal" /><span>{active ? "时限与任务详情" : "查看任务详情"}</span><Icon name="chevron-down" /></summary><div className="maintenance-details-body">
      {active && task.capabilities.extend && onExtend ? <BudgetEditor value={task.budgets} running disabled={!connected} onSave={onExtend} /> : <dl className="maintenance-metrics">{(Object.keys(maintenanceBudgetLabels) as (keyof MaintenanceBudgets)[]).map(key => <div key={key}><dt>{maintenanceBudgetLabels[key]}</dt><dd>{duration(task.budgets[key])}</dd></div>)}</dl>}
      <dl className="maintenance-record">{transfer && <><div><dt>下载来源</dt><dd>{transfer.source ?? "未提供"}</dd></div><div><dt>网络路线</dt><dd>{task.endpoint === "browser" ? "由浏览器管理，具体路线未提供" : "执行端未提供"}</dd></div></>}<div><dt>执行位置</dt><dd>{endpointLabels[task.endpoint]}</dd></div><div><dt>操作</dt><dd>{task.action}</dd></div><div><dt>当前阶段</dt><dd>{maintenancePhaseLabels[task.phase]}</dd></div><div><dt>作用范围</dt><dd>{task.scope}</dd></div><div><dt>最后更新</dt><dd>{new Date(task.updatedAt).toLocaleString()}</dd></div><div><dt>任务编号</dt><dd>{task.id}</dd></div><div><dt>尝试编号</dt><dd>{task.attemptId}</dd></div>{!active && transfer && <div><dt>接收数据</dt><dd>{bytes(transfer.received)}</dd></div>}</dl>
    </div></details>}
  </div>;
}
