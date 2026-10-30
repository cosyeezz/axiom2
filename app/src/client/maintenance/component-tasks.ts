import { maintenanceActive, type MaintenanceTask } from "../../shared/maintenance.js";

/**
 * Component standard: only the running or most recent operation is shown.
 * Interrupted or unresolved history is not kept or displayed.
 */
export function componentTasks(tasks: MaintenanceTask[], resource: string, taskId?: string) {
  const matching = tasks.filter(task => task.resource === resource && (!taskId || task.id === taskId)).reverse().sort((a, b) => b.createdAt - a.createdAt);
  const current = matching.find(maintenanceActive) ?? matching[0];
  return { current, unresolved: [] as MaintenanceTask[], history: [] as MaintenanceTask[] };
}
