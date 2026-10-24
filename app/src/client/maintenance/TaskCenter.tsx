import { useState, type ReactNode } from "react";
import { Dialog, Icon } from "../components.js";
import { maintenanceActive, type MaintenanceBudgets, type MaintenanceTask } from "../../shared/maintenance.js";
import { MaintenanceTaskView, TaskStatusIcon, endpointLabels, taskStatusLabel } from "./MaintenanceView.js";

const matchesResource = (task: MaintenanceTask, resource?: string) => task.resource === resource || resource === "resources" && task.resource.startsWith("resources:");
function source(task: MaintenanceTask) {
  if (task.endpoint === "browser") return "/display.html";
  if (matchesResource(task, "resources")) return "/resources.html";
  return `/tools.html#${task.resource.startsWith("rea") ? "rea" : task.resource.startsWith("proxy:") ? "model-proxy" : task.resource}`;
}
const filters = [["all", "全部"], ["running", "进行中"], ["attention", "需处理"], ["complete", "已结束"]] as const;
const matches = (task: MaintenanceTask, filter: string) => filter === "running" ? maintenanceActive(task) : filter === "attention" ? ["failed", "interrupted", "unknown"].includes(task.status) : filter === "complete" ? ["succeeded", "cancelled"].includes(task.status) : true;
export function TaskCenterContent({ tasks: allTasks, initialResource, connected, onClose, onCancel, onExtend, children, onSource, connectionLabel, onReconcile, reconcileId }: { tasks: MaintenanceTask[]; initialResource?: string; connected: boolean; onClose: () => void; onCancel: (task: MaintenanceTask) => Promise<unknown>; onExtend: (task: MaintenanceTask, budgets: MaintenanceBudgets) => Promise<unknown>; children?: ReactNode; onSource?: (task: MaintenanceTask) => void; connectionLabel?: string; onReconcile?: (task: MaintenanceTask) => Promise<unknown>; reconcileId?: string }) {
  const [filter, setFilter] = useState("all"), [selected, setSelected] = useState<string | undefined>(() => allTasks.findLast(task => matchesResource(task, initialResource))?.id);
  const tasks = allTasks.filter(task => matches(task, filter)).toReversed();
  const task = tasks.find(item => item.id === selected) ?? tasks[0];
  return <Dialog title="下载与维护" onClose={onClose} className="maintenance-dialog">
    <button className="maintenance-icon-button maintenance-center-close" aria-label="关闭下载与维护" onClick={onClose}><Icon name="x" /></button>
    <div className="maintenance-center-heading"><p className="maintenance-note"><span className="maintenance-online-dot" data-online={connected} />{connectionLabel ?? (connected ? "后台已连接" : "后台已断开")}<span>·</span>{onSource ? "同一安装入口依次执行" : "独立任务可同时进行"}</p></div>
    <nav className="maintenance-filters" aria-label="任务筛选">{filters.map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<small>{allTasks.filter(item => matches(item, value)).length}</small></button>)}</nav>
    <div className="maintenance-center-grid"><nav className="maintenance-task-list" aria-label="下载任务">{tasks.length ? tasks.map(item => <button key={item.id} className="maintenance-task-row" data-status={item.status} aria-current={task?.id === item.id ? "true" : undefined} onClick={() => setSelected(item.id)}><TaskStatusIcon task={item} /><span className="maintenance-row-copy"><strong>{item.label}</strong><small>{taskStatusLabel(item)} · {endpointLabels[item.endpoint]}</small><small>{new Date(item.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></span></button>) : <div className="maintenance-empty"><Icon name="inbox" /><p>暂无{filter === "all" ? "" : filters.find(item => item[0] === filter)?.[1]}任务</p></div>}</nav>
      <div className="maintenance-center-detail">{task ? <><div className="maintenance-detail-title"><h3>{task.label}</h3>{onSource ? <button className="maintenance-text-button" onClick={() => onSource(task)}>来源页面<Icon name="arrow-up-right" /></button> : <a className="maintenance-text-button" href={source(task)}>来源页面<Icon name="arrow-up-right" /></a>}</div><MaintenanceTaskView key={task.id} task={task} connected={task.endpoint === "browser" || connected} onCancel={() => onCancel(task)} onExtend={budgets => onExtend(task, budgets)} onReconcile={onReconcile && task.id === reconcileId ? () => onReconcile(task) : undefined} /></> : <div className="maintenance-empty"><Icon name="download" /><strong>每一步，都有记录</strong><p>下载、安装与校验进度会保留在这里。关闭面板，后台任务继续执行。</p></div>}</div>
    </div>
    {children}
  </Dialog>;
}
