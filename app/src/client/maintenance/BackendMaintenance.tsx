import { command, useConnectionState, useScope } from "../transport.js";
import { emptyMaintenanceState, maintenanceActive, type MaintenanceTask } from "../../shared/maintenance.js";
import { ComponentCard, type ComponentCardProps } from "./ComponentCard.js";
import { MaintenanceTaskView } from "./MaintenanceView.js";
import { componentTasks } from "./component-tasks.js";

type Props = Omit<ComponentCardProps, "maintenance"> & {
  resource: string;
  taskId?: string;
  activeOnly?: boolean;
  showError?: boolean;
  onReconcile?: (task: MaintenanceTask) => Promise<unknown>;
};

/** Backend transport only. Presentation and environment UI do not depend on this host. */
export function BackendMaintenance({ resource, taskId, activeOnly = false, location = "所连接后台 · 应用级", showError = true, onReconcile, ...card }: Props) {
  const state = useScope("maintenance", emptyMaintenanceState), connection = useConnectionState();
  const { current } = componentTasks(state.tasks, resource, taskId);
  const view = (task: MaintenanceTask) => <MaintenanceTaskView key={task.id} task={task} showError={showError} connected={connection.connected}
    onCancel={() => command("maintenance.cancel", { id: task.id })}
    onExtend={budgets => command("maintenance.extend", { id: task.id, budgets })}
    onReconcile={onReconcile ? () => onReconcile(task) : undefined} />;
  return <ComponentCard {...card} location={location} maintenance={<>
    {state.error && <p className="maintenance-warning" role="status">{state.error} 请先核实本组件状态，勿重复提交维护。</p>}
    {current && (!activeOnly || maintenanceActive(current)) && view(current)}
  </>} />;
}
