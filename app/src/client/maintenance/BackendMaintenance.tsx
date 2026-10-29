import type { ReactNode } from "react";
import { command, useConnectionState, useScope } from "../transport.js";
import { emptyMaintenanceState, maintenanceActive, type MaintenanceTask } from "../../shared/maintenance.js";
import { ComponentCard } from "./ComponentCard.js";
import { MaintenanceTaskView } from "./MaintenanceView.js";

const matchesResource = (task: MaintenanceTask, resource: string) => task.resource === resource || resource === "resources" && task.resource.startsWith("resources:");
/** Preserve existing callers and task ownership while replacing the removed task-center surface. */
export function BackendMaintenance({ resource, label, children, location = "所连接后台 · 应用级", activeOnly = false, showError = true }: { resource: string; label: string; children?: ReactNode; location?: string; activeOnly?: boolean; showError?: boolean }) {
  const state = useScope("maintenance", emptyMaintenanceState), connection = useConnectionState();
  const task = state.tasks.findLast(task => matchesResource(task, resource) && (!activeOnly || maintenanceActive(task)));
  return <ComponentCard label={label} location={location} maintenance={task && <MaintenanceTaskView task={task} showError={showError} connected={connection.connected}
    onCancel={() => command("maintenance.cancel", { id: task.id })}
    onExtend={budgets => command("maintenance.extend", { id: task.id, budgets })} />}>{children}</ComponentCard>;
}
