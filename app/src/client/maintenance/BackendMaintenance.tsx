import { browserMaintenanceCommand, useBrowserMaintenance } from "./browser-maintenance.js";
import { useState, type ReactNode } from "react";
import { Icon } from "../components.js";
import { TaskCenterContent } from "./TaskCenter.js";
export { TaskCenterContent } from "./TaskCenter.js";
import { command, useConnectionState, useScope } from "../transport.js";
import { emptyMaintenanceState, maintenanceActive, type MaintenanceBudgets, type MaintenanceTask } from "../../shared/maintenance.js";
import { BudgetEditor, MaintenancePanel } from "./MaintenanceView.js";

const matchesResource = (task: MaintenanceTask, resource?: string) => task.resource === resource || resource === "resources" && task.resource.startsWith("resources:");
export function BackendTaskCenter({ onClose, initialResource }: { onClose: () => void; initialResource?: string }) {
  const backend = useScope("maintenance", emptyMaintenanceState), browser = useBrowserMaintenance(), connection = useConnectionState();
  const tasks = [...backend.tasks, ...browser.tasks].sort((a, b) => a.createdAt - b.createdAt);
  const [error, setError] = useState("");
  return <TaskCenterContent tasks={tasks} initialResource={initialResource} connected={connection.connected} onClose={onClose} onCancel={task => task.endpoint === "browser" ? browserMaintenanceCommand("cancel", task.id) : command("maintenance.cancel", { id: task.id })} onExtend={(task, budgets) => task.endpoint === "browser" ? browserMaintenanceCommand("extend", task.id, budgets) : command("maintenance.extend", { id: task.id, budgets })}>
    {(backend.error || browser.error || error) && <p className="maintenance-error" role="alert"><Icon name="circle-alert" /><span>{backend.error || browser.error || error}</span></p>}
    <div className="maintenance-center-settings"><details className="maintenance-details"><summary><Icon name="server" /><span>后台下载设置</span><Icon name="chevron-down" /></summary><BudgetEditor value={backend.budgets} disabled={!connection.connected} onSave={budgets => command("maintenance.defaults", { budgets })} /></details>
      <details className="maintenance-details"><summary><Icon name="globe" /><span>浏览器下载设置</span><Icon name="chevron-down" /></summary><BudgetEditor value={browser.budgets} onSave={budgets => browserMaintenanceCommand("defaults", undefined, budgets)} /></details></div>
    <div className="maintenance-center-footer"><p className="maintenance-note">进行中及待核实的任务会保留</p><button className="maintenance-text-button" onClick={() => { setError(""); void Promise.all([browserMaintenanceCommand("clear"), ...(connection.connected ? [command("maintenance.clear")] : [])]).catch(error => setError(error.message)); }}><Icon name="trash-2" />清理已结束记录</button></div>
  </TaskCenterContent>;
}
export function BackendMaintenanceLauncher() {
  const [open, setOpen] = useState(false);
  return <><button className="btn btn-ghost maintenance-launcher" onClick={() => setOpen(true)}><Icon name="download" />下载与维护</button>{open && <BackendTaskCenter onClose={() => setOpen(false)} />}</>;
}
export function BackendMaintenance({ resource, label, children, location = "所连接后台 · 应用级", activeOnly = false, showError = true }: { resource: string; label: string; children?: ReactNode; location?: string; activeOnly?: boolean; showError?: boolean }) {
  const state = useScope("maintenance", emptyMaintenanceState), connection = useConnectionState();
  const [open, setOpen] = useState(false);
  const task = state.tasks.findLast(task => matchesResource(task, resource) && (!activeOnly || maintenanceActive(task)));
  const extend = (budgets: MaintenanceBudgets) => command("maintenance.extend", { id: task?.id, budgets });
  return <><MaintenancePanel label={label} location={location} task={task} showError={showError} connected={connection.connected} onOpenTasks={() => setOpen(true)} onCancel={() => command("maintenance.cancel", { id: task?.id })} onExtend={extend}>{children}</MaintenancePanel>{open && <BackendTaskCenter initialResource={resource} onClose={() => setOpen(false)} />}</>;
}
